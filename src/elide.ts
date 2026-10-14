import { graphemes, isWhitespace } from './graphemes.js';
import { type Cut, type Position, type Snap, positionValue, rawCut, refineCut, searchMax } from './cut.js';
import {
  type Gap,
  type GapPlan,
  type GlyphMetrics,
  type Font,
  applyTextTransform,
  clearMetrics,
  dotSpacing,
  fontAscent,
  fontOf,
  measure,
  planGap,
  resolveGap,
} from './metrics.js';

export interface ElideOptions {
  /** Text to show. Defaults to the element's text content (whitespace collapsed). */
  text?: string;
  /** Maximum number of lines. Default 1. */
  lines?: number;
  /** Where the ellipsis goes: 'start' | 'middle' | 'end' or 0..1. Default 'end'. */
  position?: Position;
  /** Ellipsis string. Default '…'. */
  ellipsis?: string;
  /**
   * Ink gap on both sides of the ellipsis:
   * - 'dots' (default): same as the space between the ellipsis' own dots
   * - 'natural': average of the font's natural gaps, so the total width is kept
   * - 'none': leave spacing alone
   * - a px number, or a string like '0.12em' / '2px'
   */
  gap?: Gap;
  /** Drop whitespace touching the ellipsis. Default true. */
  trim?: boolean;
  /** Experimental: move the cut to nicer boundaries, see `separators()`. */
  snap?: Snap | null;
  /**
   * Make a truncated line end exactly at the edge of the available area, so
   * resizing flows smoothly instead of stepping a glyph at a time:
   * - 'ellipsis' (default): the slack goes into the two gaps around the
   *   ellipsis, equally. Head and tail stay put; the ellipsis floats between.
   * - 'spread': the slack is spread over the line as letter-spacing, like
   *   justified text. Single-line only; multi-line falls back to 'ellipsis'.
   * - false: leave the slack at the end of the line.
   * Applies when the ellipsis is on the last line.
   */
  justify?: 'ellipsis' | 'spread' | false;
  /** Re-truncate when the element is resized. Default true. */
  observe?: boolean;
  /**
   * Wrap every grapheme in its own element so it can be styled or animated
   * (see `floating-points/transitions`). Costs more DOM; meant for small texts and demos.
   */
  glyphs?: boolean;
  /** Shorthand for `instance.onChange(fn)`. */
  onChange?: (change: ElideChange) => void;
}

type Settings = Required<Omit<ElideOptions, 'text' | 'onChange'>>;

export interface ElideState {
  text: string;
  /** Number of graphemes in `text`. */
  length: number;
  truncated: boolean;
  /** Graphemes `[0, start)` are shown before the ellipsis. */
  start: number;
  /** Graphemes `[end, length)` are shown after the ellipsis. */
  end: number;
  /** Visible text before the ellipsis (the whole text when not truncated). */
  head: string;
  /** Visible text after the ellipsis. */
  tail: string;
  /** Text replaced by the ellipsis. */
  omitted: string;
  /** Rendered line count. */
  lines: number;
  /** Spacing applied around the ellipsis. */
  gap: GapInfo | null;
}

export interface GapInfo extends GapPlan {
  /** Final ink gap left of the ellipsis, after justification (null = no glyph there). */
  left: number | null;
  /** Final ink gap right of the ellipsis, after justification (null = no glyph there). */
  right: number | null;
  /** Slack that justification added to the line, in px. */
  slack: number;
  /** Letter-spacing added to the line by `justify: 'spread'`, in px. */
  spread: number;
}

export type ChangeReason = 'init' | 'resize' | 'update' | 'fonts' | 'refresh';

export interface ElideChange {
  reason: ChangeReason;
  state: ElideState;
  previous: ElideState | null;
  /** The text (or glyph mode) changed, so indices in `previous` don't map onto `state`. */
  reset: boolean;
  /** Grapheme indices that became visible. */
  shown: number[];
  /** Grapheme indices that became hidden. */
  hidden: number[];
  /** Glyph mode only: where each newly hidden glyph was just before the update. */
  hiddenRects: Map<number, DOMRect>;
  /** Ellipsis box before and after the update (null when there was none). */
  ellipsis: { from: DOMRect | null; to: DOMRect | null };
}

interface Run {
  font: Font;
  ellipsisFont: Font;
  letterSpacing: number;
  transform: string;
  ellipsis: GlyphMetrics;
  target: number | 'natural' | 'none';
  left: number;
  right: number;
}

const SR_ONLY =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;' +
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;user-select:none';

const DEFAULTS: Settings = {
  lines: 1,
  position: 'end',
  ellipsis: '…',
  gap: 'dots',
  trim: true,
  snap: null,
  justify: 'ellipsis',
  observe: true,
  glyphs: false,
};

const instances = new Set<Elide>();
let fontsHooked = false;

function hookFonts() {
  if (fontsHooked || typeof document === 'undefined' || !document.fonts) return;
  fontsHooked = true;
  const refresh = () => {
    clearMetrics();
    for (const instance of instances) instance.refresh('fonts');
  };
  document.fonts.addEventListener('loadingdone', refresh);
  void document.fonts.ready.then(refresh);
}

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export class Elide {
  readonly element: HTMLElement;
  /** The ellipsis element. Stable for the lifetime of the instance, so listeners can stay attached. */
  readonly ellipsisElement: HTMLSpanElement;

  private settings: Settings;
  private text = '';
  private g: string[] = [];
  private offsets: number[] = [0];
  private glyphEls: HTMLSpanElement[] = [];
  private readonly original: Node[];
  private readonly srEl: HTMLSpanElement;
  private readonly lineEl: HTMLSpanElement;
  private readonly headEl: HTMLSpanElement;
  private readonly joinEl: HTMLSpanElement;
  private readonly tailEl: HTMLSpanElement;
  private readonly listeners = new Set<(change: ElideChange) => void>();
  private observer: ResizeObserver | null = null;
  private lastWidth = -1;
  private hint: number | null = null;
  private current: ElideState | null = null;
  private lastRun: Run | null = null;
  private pendingReset = false;
  private destroyed = false;

  constructor(element: HTMLElement, options: ElideOptions = {}) {
    const { text, onChange, ...rest } = options;
    this.element = element;
    this.settings = { ...DEFAULTS, ...defined(rest) };
    this.original = Array.from(element.childNodes);

    const span = (attr: string, style = '') => {
      const el = document.createElement('span');
      el.setAttribute(attr, '');
      if (style) el.style.cssText = style;
      return el;
    };
    this.srEl = span('data-fp-full', SR_ONLY);
    this.lineEl = span('data-fp-text');
    this.lineEl.setAttribute('aria-hidden', 'true');
    this.headEl = span('data-fp-head');
    this.joinEl = span('data-fp-join', 'white-space:nowrap');
    this.tailEl = span('data-fp-tail');
    this.ellipsisElement = span('data-fp-ellipsis');
    this.ellipsisElement.textContent = this.settings.ellipsis;
    this.lineEl.append(this.headEl, this.joinEl, this.tailEl);

    this.setText(text ?? (element.textContent ?? '').replace(/\s+/g, ' ').trim());
    element.replaceChildren(this.srEl, this.lineEl);

    if (onChange) this.listeners.add(onChange);
    instances.add(this);
    hookFonts();
    this.run('init');
    this.observe(this.settings.observe);
  }

  /** Current result. Before the first layout it describes the untruncated text. */
  get state(): ElideState {
    return this.current ?? this.makeState(null, 0, null);
  }

  get truncated(): boolean {
    return this.current?.truncated ?? false;
  }

  /** The text split into graphemes; state indices refer to this array. */
  get graphemes(): readonly string[] {
    return this.g;
  }

  /** Box of the ellipsis element in viewport coordinates, or null when not truncated. */
  ellipsisRect(): DOMRect | null {
    return this.truncated ? this.ellipsisElement.getBoundingClientRect() : null;
  }

  /** Tight box around the ellipsis' ink in viewport coordinates, or null when not truncated. */
  ellipsisInk(): DOMRect | null {
    const run = this.lastRun;
    if (!this.truncated || !run) return null;
    const box = this.ellipsisElement.getBoundingClientRect();
    const baseline = box.top + fontAscent(run.ellipsisFont);
    const e = run.ellipsis;
    return new DOMRect(box.left - e.left, baseline - e.ascent, e.left + e.right, e.ascent + e.descent);
  }

  /** One box per rendered line of visible text, in viewport coordinates. */
  lineRects(): DOMRect[] {
    return Array.from(this.lineEl.getClientRects());
  }

  /** Element of grapheme `index` in glyph mode (null otherwise or when out of range). */
  glyph(index: number): HTMLSpanElement | null {
    return this.glyphEls[index] ?? null;
  }

  /** Subscribe to visible-text changes. Returns an unsubscribe function. */
  onChange(fn: (change: ElideChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Change text and/or options and re-truncate. */
  update(options: ElideOptions): void {
    const { text, onChange, ...rest } = options;
    if (onChange) this.listeners.add(onChange);
    const before = this.settings;
    this.settings = { ...before, ...defined(rest) };
    if (this.settings.ellipsis !== before.ellipsis) this.ellipsisElement.textContent = this.settings.ellipsis;
    if (this.settings.observe !== before.observe) this.observe(this.settings.observe);
    if ((text !== undefined && text !== this.text) || this.settings.glyphs !== before.glyphs) {
      this.setText(text ?? this.text);
      this.pendingReset = true;
    }
    this.run('update');
  }

  /** Re-measure and re-truncate, e.g. after a style change the observer can't see. */
  refresh(reason: ChangeReason = 'refresh'): void {
    this.run(reason);
  }

  /** Stop observing and restore the element's original content. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observe(false);
    instances.delete(this);
    this.listeners.clear();
    this.element.removeAttribute('data-truncated');
    this.element.replaceChildren(...this.original);
  }

  // -------------------------------------------------------------------------

  private observe(on: boolean) {
    if (!on) {
      this.observer?.disconnect();
      this.observer = null;
      return;
    }
    if (this.observer || typeof ResizeObserver === 'undefined') return;
    this.lastWidth = -1;
    this.observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]!;
      const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      // Height changes are usually our own doing (fewer lines); only width matters.
      if (Math.abs(width - this.lastWidth) < 0.01) return;
      this.lastWidth = width;
      this.run('resize');
    });
    this.observer.observe(this.element);
  }

  private setText(text: string) {
    this.text = text;
    this.g = graphemes(text);
    this.offsets = [0];
    for (const s of this.g) this.offsets.push(this.offsets[this.offsets.length - 1]! + s.length);
    this.glyphEls = this.settings.glyphs
      ? this.g.map((s, i) => {
          const el = document.createElement('span');
          el.setAttribute('data-fp-glyph', String(i));
          el.textContent = s;
          return el;
        })
      : [];
    this.srEl.textContent = text;
    this.hint = null;
  }

  private prepare(cs: CSSStyleDeclaration): Run {
    const font = fontOf(cs);
    const letterSpacing = parseFloat(cs.letterSpacing) || 0;
    const transform = cs.textTransform;
    const { ellipsis: ellipsisText, gap } = this.settings;

    // The ellipsis may be styled on its own (weight, size, family), so read
    // its style in place. Rendering resets the join afterwards.
    if (!this.ellipsisElement.isConnected) this.joinEl.append(this.ellipsisElement);
    const ecs = getComputedStyle(this.ellipsisElement);
    const ellipsisFont = fontOf(ecs);
    const shownEllipsis = applyTextTransform(ellipsisText, ecs.textTransform);
    const marks = graphemes(shownEllipsis).length;
    const spacing = parseFloat(ecs.letterSpacing) || 0;
    const m = measure(ellipsisFont, shownEllipsis);
    const ellipsis = spacing ? { ...m, advance: m.advance + spacing * marks } : m;
    const target = resolveGap(gap, parseFloat(ecs.fontSize), () => {
      const dots = dotSpacing(ellipsisFont, shownEllipsis);
      // Letter-spacing widens the gaps between separate characters like '...'.
      return dots === null ? null : dots + (marks > 1 ? spacing : 0);
    });

    const host = this.element;
    const box = host.getBoundingClientRect();
    const left = box.left + host.clientLeft + parseFloat(cs.paddingLeft);
    const right = box.left + host.clientLeft + host.clientWidth - parseFloat(cs.paddingRight);
    return { font, ellipsisFont, letterSpacing, transform, ellipsis, target, left, right };
  }

  private glyphMetrics(run: Run, g: string): GlyphMetrics {
    const m = measure(run.font, applyTextTransform(g, run.transform));
    return run.letterSpacing ? { ...m, advance: m.advance + run.letterSpacing } : m;
  }

  private fill(el: HTMLElement, from: number, to: number) {
    if (this.settings.glyphs) el.replaceChildren(...this.glyphEls.slice(from, to));
    else el.textContent = this.text.slice(this.offsets[from], this.offsets[to]);
  }

  private piece(i: number): Node {
    return this.settings.glyphs ? this.glyphEls[i]! : document.createTextNode(this.g[i]!);
  }

  /** Put a cut (or the full text, when null) into the DOM. */
  private render(run: Run, cut: Cut | null): GapPlan | null {
    const n = this.g.length;
    if (!cut) {
      this.lineEl.style.letterSpacing = '';
      this.fill(this.headEl, 0, n);
      this.joinEl.replaceChildren();
      this.fill(this.tailEl, n, n);
      return null;
    }
    const { start, end } = cut;
    const hasHead = start > 0;
    const hasTail = end < n;
    this.fill(this.headEl, 0, hasHead ? start - 1 : 0);
    const join: Node[] = [];
    if (hasHead) join.push(this.piece(start - 1));
    join.push(this.ellipsisElement);
    if (hasTail) join.push(this.piece(end));
    this.joinEl.replaceChildren(...join);
    this.fill(this.tailEl, hasTail ? end + 1 : n, n);
    this.lineEl.style.letterSpacing = '';

    const before = hasHead && !isWhitespace(this.g[start - 1]) ? this.glyphMetrics(run, this.g[start - 1]!) : null;
    const after = hasTail && !isWhitespace(this.g[end]) ? this.glyphMetrics(run, this.g[end]!) : null;
    const plan = planGap(before, run.ellipsis, after, run.target);
    this.applyMargins(plan);
    return plan;
  }

  /** Does the rendered text fit? Reads layout. */
  private measure(run: Run): { ok: boolean; lines: number } {
    let lines = 0;
    let lastTop = NaN;
    let ok = true;
    for (const r of this.lineEl.getClientRects()) {
      if (!(Math.abs(r.top - lastTop) < 1)) lines++;
      lastTop = r.top;
      if (r.right > run.right + 0.05 || r.left < run.left - 0.05) ok = false;
    }
    return { ok: ok && lines <= this.settings.lines, lines };
  }

  private run(reason: ChangeReason) {
    const host = this.element;
    if (this.destroyed || !host.isConnected || host.getClientRects().length === 0) return;

    const run = this.prepare(getComputedStyle(host));
    this.lastRun = run;
    const previous = this.current;
    const reset = this.pendingReset || !previous;
    this.pendingReset = false;

    // Capture "before" geometry for listeners that animate the change.
    const tracking = this.listeners.size > 0;
    const before = new Map<number, DOMRect>();
    let ellipsisFrom: DOMRect | null = null;
    if (tracking && previous && !reset) {
      ellipsisFrom = this.ellipsisRect();
      if (this.settings.glyphs) {
        for (let i = 0; i < previous.length; i++) {
          if (isVisible(previous, i)) before.set(i, this.glyphEls[i]!.getBoundingClientRect());
        }
      }
    }

    const n = this.g.length;
    const position = positionValue(this.settings.position);
    const cutAt = (k: number) => refineCut(this.g, rawCut(n, k, position), position, this.settings.snap, this.settings.trim);

    let cut: Cut | null = null;
    this.render(run, null);
    let fit = this.measure(run);
    if (!fit.ok && n > 0) {
      const kept = searchMax(0, n - 1, (k) => {
        this.render(run, cutAt(k));
        return this.measure(run).ok;
      }, this.hint);
      this.hint = kept;
      cut = cutAt(kept);
    }
    const plan = this.render(run, cut);
    let gap: GapInfo | null = null;
    if (cut && plan) {
      fit = this.measure(run);
      gap = this.justify(run, cut, plan, fit.lines);
    }

    const state = this.makeState(cut, fit.lines, gap);
    this.current = state;
    host.toggleAttribute('data-truncated', state.truncated);

    if (!tracking) return;
    const same = previous && !reset && previous.truncated === state.truncated
      && previous.start === state.start && previous.end === state.end;
    if (same && (reason === 'resize' || reason === 'refresh')) return;

    const shown: number[] = [];
    const hidden: number[] = [];
    const hiddenRects = new Map<number, DOMRect>();
    if (!reset && previous) {
      for (let i = 0; i < n; i++) {
        const was = isVisible(previous, i);
        const is = isVisible(state, i);
        if (is && !was) shown.push(i);
        else if (was && !is) {
          hidden.push(i);
          const rect = before.get(i);
          if (rect) hiddenRects.set(i, rect);
        }
      }
    }
    const change: ElideChange = {
      reason,
      state,
      previous: reset ? null : previous,
      reset,
      shown,
      hidden,
      hiddenRects,
      ellipsis: { from: ellipsisFrom, to: this.ellipsisRect() },
    };
    for (const fn of this.listeners) fn(change);
  }

  /**
   * Stretch the line holding the ellipsis so it ends exactly at the right
   * edge. Only for the last line: on earlier lines the slack comes from word
   * wrapping and would make a hole.
   */
  private justify(run: Run, cut: Cut, plan: GapPlan, lines: number): GapInfo {
    const info = (slack: number, spread: number): GapInfo => ({
      ...plan,
      left: plan.naturalLeft === null ? null : plan.naturalLeft + plan.marginLeft + spread,
      right: plan.naturalRight === null ? null : plan.naturalRight + plan.marginRight + spread,
      slack,
      spread,
    });
    const mode = this.settings.justify;
    const last = this.lastLine();
    if (!mode || !last) return info(0, 0);
    const e = this.ellipsisElement.getBoundingClientRect();
    const middle = e.top + e.height / 2;
    if (middle < last.top || middle > last.bottom) return info(0, 0);
    const room = run.right - last.right;
    if (room <= 0) return info(0, 0);

    const holds = () => {
      const m = this.measure(run);
      return m.ok && m.lines === lines;
    };
    const hasHead = cut.start > 0;
    const hasTail = cut.end < this.g.length;

    // Layout snaps each inline piece to 1/64 px, so filling the line exactly
    // can tip it over and wrap. Stay a hair inside, backing off if needed.
    for (const inset of [1 / 16, 0.25, 1]) {
      const slack = room - inset;
      if (slack <= 0) break;

      if (mode === 'spread' && lines === 1) {
        // Letter-spacing goes after every character, so the line grows by
        // spacing x characters; measure the growth instead of counting.
        const probe = slack / Math.max(1, this.lineEl.textContent?.length ?? 1);
        this.lineEl.style.letterSpacing = `${run.letterSpacing + probe}px`;
        const grown = (this.lastLine()?.right ?? last.right) - last.right;
        const spread = grown > 0 ? (probe * slack) / grown : 0;
        this.lineEl.style.letterSpacing = `${run.letterSpacing + spread}px`;
        if (holds()) return info(slack, spread);
        continue;
      }

      const share = hasHead && hasTail ? slack / 2 : slack;
      const stretched = {
        ...plan,
        marginLeft: plan.marginLeft + (hasHead ? share : 0),
        marginRight: plan.marginRight + (hasTail ? share : 0),
      };
      this.applyMargins(stretched);
      if (holds()) {
        return {
          ...info(slack, 0),
          left: plan.naturalLeft === null ? null : plan.naturalLeft + stretched.marginLeft,
          right: plan.naturalRight === null ? null : plan.naturalRight + stretched.marginRight,
        };
      }
    }
    this.lineEl.style.letterSpacing = '';
    this.applyMargins(plan);
    return info(0, 0);
  }

  /**
   * Vertical extent and right edge of the last rendered line. A line can come
   * back as several boxes (e.g. around absolutely positioned children), so
   * take the union of the boxes that share the last line.
   */
  private lastLine(): { top: number; bottom: number; right: number } | null {
    const rects = Array.from(this.lineEl.getClientRects());
    if (!rects.length) return null;
    const top = Math.max(...rects.map((r) => r.top));
    const line = rects.filter((r) => r.top > top - 1);
    return {
      top,
      bottom: Math.max(...line.map((r) => r.bottom)),
      right: Math.max(...line.map((r) => r.right)),
    };
  }

  private applyMargins(plan: { marginLeft: number; marginRight: number }) {
    const style = this.ellipsisElement.style;
    style.marginLeft = plan.marginLeft ? `${plan.marginLeft}px` : '';
    style.marginRight = plan.marginRight ? `${plan.marginRight}px` : '';
  }

  private makeState(cut: Cut | null, lines: number, gap: GapInfo | null): ElideState {
    const n = this.g.length;
    const at = (i: number) => this.offsets[i]!;
    const start = cut ? cut.start : n;
    const end = cut ? cut.end : n;
    return {
      text: this.text,
      length: n,
      truncated: cut !== null,
      start,
      end,
      head: this.text.slice(0, at(start)),
      tail: cut ? this.text.slice(at(end)) : '',
      omitted: cut ? this.text.slice(at(start), at(end)) : '',
      lines,
      gap,
    };
  }
}

function isVisible(state: ElideState, i: number): boolean {
  return !state.truncated || i < state.start || i >= state.end;
}

/** Truncate `element`'s text. Returns a live instance; call `destroy()` to undo. */
export function elide(element: HTMLElement, options?: ElideOptions): Elide {
  return new Elide(element, options);
}
