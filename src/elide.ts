import { graphemes, isWhitespace } from './graphemes.js';
import {
  type Keep,
  type Layout,
  type Position,
  type Range,
  type Snap,
  hiddenRanges,
  keepRanges,
  layoutFor,
  searchMax,
  toGraphemeRanges,
} from './cut.js';
import {
  type Font,
  type Gap,
  type GapPlan,
  type GlyphMetrics,
  applyTextTransform,
  clearMetrics,
  fontAscent,
  fontOf,
  measure,
  planGap,
  resolveGap,
} from './metrics.js';
import { type EllipsisStyle, type MarkLayout, buildMarks, ellipsisText, groupMetrics, layoutMarks } from './marks.js';

/**
 * The marks actually drawn. `justify: 'dots'` needs separate marks, so a
 * single glyph like '…' is redrawn as dots sized and placed like its own.
 */
/** How many dots the horizontal dotted characters are made of. */
const DOTS_IN: Record<string, number> = { '…': 3, '⋯': 3, '‥': 2 };

function markStyleFor(settings: { ellipsis: EllipsisStyle; justify: unknown }): EllipsisStyle {
  const e = settings.ellipsis;
  if (settings.justify === 'dots' && typeof e === 'string' && graphemes(e).length === 1) {
    return { shape: 'dot', like: e, count: DOTS_IN[e] ?? 1 };
  }
  return e;
}

export interface ElideOptions {
  /** Text to show. Defaults to the element's text content (whitespace collapsed). */
  text?: string;
  /** Maximum number of lines. Default 1. */
  lines?: number;
  /**
   * Where the ellipsis goes: 'start' | 'middle' | 'end' or 0..1. Default 'end'.
   * An array places several ellipses, e.g. `[0.33, 0.67]`.
   */
  position?: Position | Position[];
  /**
   * Parts that always stay visible: a string (first match), a RegExp (every
   * match if global, else the first) or `{ start, end }` string offsets. Text
   * hidden on both sides of a kept part gets an ellipsis on each side.
   * Earlier entries win when not all of them fit.
   */
  keep?: Keep | Keep[] | null;
  /**
   * What the ellipsis looks like: a string ('…' by default, '...', '·····')
   * or drawn marks, e.g. `{ shape: 'bullet', count: 5 }`. See `MarkStyle`.
   * An empty string or `count: 0` leaves just a balanced gap.
   */
  ellipsis?: EllipsisStyle;
  /**
   * Ink gap on both sides of the ellipsis:
   * - 'dots' (default): same as the space between the ellipsis' own marks
   * - 'natural': average of the font's natural gaps, so the total width is kept
   * - 'none': leave spacing alone
   * - a px number, or a string like '0.12em' / '2px'
   */
  gap?: Gap;
  /**
   * Make every line holding an ellipsis end exactly at the edge of the
   * available area, so resizing flows smoothly instead of stepping a glyph
   * at a time:
   * - 'dots' (default): the slack evens out every gap, so text, marks and
   *   text again are all equally spaced. A single glyph like '…' is redrawn
   *   as separate dots shaped like its own.
   * - 'ellipsis': the slack goes into the two gaps around the ellipsis,
   *   equally. The dots keep their spacing and float between the text.
   * - 'spread': the slack is spread over the line as letter-spacing, like
   *   justified text. Single-line only; otherwise behaves like 'ellipsis'.
   * - false: leave the slack at the end of the line.
   */
  justify?: 'ellipsis' | 'dots' | 'spread' | false;
  /** Drop whitespace touching an ellipsis. Default true. */
  trim?: boolean;
  /** Experimental: move cuts to nicer boundaries, see `separators()`. */
  snap?: Snap | null;
  /** Re-truncate when the element is resized. Default true. */
  observe?: boolean;
  /**
   * Wrap every grapheme in its own element so it can be styled or animated
   * (see `floating-ellipsis/transitions`). Costs more DOM; meant for short texts.
   */
  glyphs?: boolean;
  /** Put the full text in the element's `title` while truncated. Default false. */
  title?: boolean;
  /**
   * What a copied selection contains where it crosses an ellipsis:
   * 'full' (default) the hidden text, 'visible' the ellipsis itself.
   */
  copy?: 'full' | 'visible';
  /** Shorthand for `instance.onChange(fn)`. */
  onChange?: (change: ElideChange) => void;
}

type Settings = Required<Omit<ElideOptions, 'text' | 'onChange'>>;

/** A stretch of text, by grapheme index. */
export interface Part {
  start: number;
  end: number;
  text: string;
}

/** Spacing around one ellipsis. All gaps are ink to ink, in px. */
export interface GapInfo extends GapPlan {
  /** Final gap left of the ellipsis (null = no glyph there). */
  left: number | null;
  /** Final gap right of the ellipsis (null = no glyph there). */
  right: number | null;
  /** Final gaps between the ellipsis' marks. */
  inner: number[];
  /** Space this ellipsis took in from justification. */
  slack: number;
}

export interface ElideState {
  text: string;
  /** Number of graphemes in `text`. */
  length: number;
  truncated: boolean;
  /** The hidden parts, one per ellipsis, in order. */
  hidden: Part[];
  /** Kept parts (from `keep`) that are showing while truncated. */
  kept: Part[];
  /** Rendered line count. */
  lines: number;
  /** Spacing around each ellipsis. */
  gaps: GapInfo[];
  /**
   * Room that was left on the lines holding ellipses before justification
   * took it in, in px. Small values mean the text is tightly packed.
   */
  slack: number;
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
  /** Glyph mode only: box and ink box of each newly hidden glyph as last painted. */
  hiddenGlyphs: Map<number, { box: DOMRect; ink: DOMRect }>;
  /** Glyph mode only: box and ink box of every glyph that was showing, as last painted. */
  glyphsBefore: Map<number, { box: DOMRect; ink: DOMRect }>;
  /** Mark boxes of each ellipsis just before the update. */
  marksBefore: DOMRect[][];
}

interface Run {
  font: Font;
  letterSpacing: number;
  transform: string;
  left: number;
  right: number;
  marks: MarkLayout | null;
}

interface Join {
  el: HTMLSpanElement;
  before: HTMLSpanElement;
  ellipsis: HTMLSpanElement;
  after: HTMLSpanElement;
  marks: HTMLSpanElement[];
}

const SR_ONLY =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;' +
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;user-select:none';

const DEFAULTS: Settings = {
  lines: 1,
  position: 'end',
  keep: null,
  ellipsis: '…',
  gap: 'dots',
  justify: 'dots',
  trim: true,
  snap: null,
  observe: true,
  glyphs: false,
  title: false,
  copy: 'full',
};

const instances = new Set<Elide>();
const byId = new Map<string, Elide>();
let nextId = 1;
let hooked = false;

function hookDocument() {
  if (hooked || typeof document === 'undefined') return;
  hooked = true;
  document.addEventListener('copy', onCopy);
  if (!document.fonts) return;
  const refresh = () => {
    clearMetrics();
    for (const instance of instances) instance.refresh('fonts');
  };
  document.fonts.addEventListener('loadingdone', refresh);
  void document.fonts.ready.then(refresh);
}

/**
 * When a selection crosses an ellipsis, copy what it stands for. The
 * selection is cloned, each ellipsis in it replaced by its hidden text, and
 * the result laid out offscreen so `innerText` keeps the page's line breaks.
 */
function onCopy(event: ClipboardEvent) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !event.clipboardData) return;
  const range = selection.getRangeAt(0);
  let touched = false;
  for (const instance of instances) {
    if (instance.ellipses.some((e) => range.intersectsNode(e))) touched = true;
  }
  if (!touched) return;

  const fragment = range.cloneContents();
  for (const el of fragment.querySelectorAll('[data-fp-full], [data-fp-ghosts]')) el.remove();
  for (const el of fragment.querySelectorAll<HTMLElement>('[data-fp-ellipsis]')) {
    const [id, index] = (el.dataset.fpEllipsis ?? '').split(':');
    const instance = byId.get(id ?? '');
    const part = instance?.state.hidden[Number(index)];
    const full = instance?.options.copy === 'full';
    el.replaceWith(full && part ? part.text : ellipsisText(instance?.options.ellipsis ?? '…'));
  }
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:pre-wrap';
  holder.append(fragment);
  document.body.append(holder);
  event.clipboardData.setData('text/plain', holder.innerText);
  event.clipboardData.setData('text/html', holder.innerHTML);
  holder.remove();
  event.preventDefault();
}

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const asArray = <T,>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export class Elide {
  readonly element: HTMLElement;

  private settings: Settings;
  private readonly id = String(nextId++);
  private text = '';
  private g: string[] = [];
  private offsets: number[] = [0];
  private glyphEls: HTMLSpanElement[] = [];
  private pins: Range[] = [];
  private layout: Layout = layoutFor(0, ['end']);
  private readonly original: Node[];
  private readonly srEl: HTMLSpanElement;
  private readonly lineEl: HTMLSpanElement;
  private readonly runs: HTMLSpanElement[] = [];
  private readonly joins: Join[] = [];
  private readonly listeners = new Set<(change: ElideChange) => void>();
  private readonly renderListeners = new Set<(state: ElideState) => void>();
  private observer: ResizeObserver | null = null;
  private lastWidth = -1;
  private hint: number | null = null;
  private current: ElideState | null = null;
  private lastRun: Run | null = null;
  private pendingReset = false;
  private titled = false;
  private destroyed = false;
  private style: EllipsisStyle = '…';
  private painted: { glyphs: Map<number, { box: DOMRect; ink: DOMRect }>; marks: DOMRect[][] } | null = null;

  constructor(element: HTMLElement, options: ElideOptions = {}) {
    const { text, onChange, ...rest } = options;
    this.element = element;
    this.settings = { ...DEFAULTS, ...defined(rest) };
    this.original = Array.from(element.childNodes);

    this.srEl = document.createElement('span');
    this.srEl.setAttribute('data-fp-full', '');
    this.srEl.style.cssText = SR_ONLY;
    this.lineEl = document.createElement('span');
    this.lineEl.setAttribute('data-fp-text', '');
    this.lineEl.setAttribute('aria-hidden', 'true');
    this.join(0);

    this.setText(text ?? (element.textContent ?? '').replace(/\s+/g, ' ').trim());
    element.replaceChildren(this.srEl, this.lineEl);

    if (onChange) this.listeners.add(onChange);
    instances.add(this);
    byId.set(this.id, this);
    hookDocument();
    this.run('init');
    this.observe(this.settings.observe);
  }

  /** Current settings. */
  get options(): Readonly<Settings> {
    return this.settings;
  }

  /** Current result. Before the first layout it describes the untruncated text. */
  get state(): ElideState {
    return this.current ?? this.makeState([], 0, []);
  }

  get truncated(): boolean {
    return this.current?.truncated ?? false;
  }

  /** The text split into graphemes; state indices refer to this array. */
  get graphemes(): readonly string[] {
    return this.g;
  }

  /** The first ellipsis element. Stable for the lifetime of the instance. */
  get ellipsisElement(): HTMLSpanElement {
    return this.joins[0]!.ellipsis;
  }

  /** The ellipsis elements currently showing, in order. */
  get ellipses(): HTMLSpanElement[] {
    return this.joins.slice(0, this.current?.hidden.length ?? 0).map((j) => j.ellipsis);
  }

  /** Index of the ellipsis containing `node` (e.g. an event target), or -1. */
  ellipsisIndex(node: Node | null): number {
    return node ? this.ellipses.findIndex((e) => e.contains(node)) : -1;
  }

  /** Box of ellipsis `index` in viewport coordinates, or null. */
  ellipsisRect(index = 0): DOMRect | null {
    const e = this.ellipses[index];
    return e ? e.getBoundingClientRect() : null;
  }

  /** Tight box around the ink of ellipsis `index`, or null. */
  ellipsisInk(index = 0): DOMRect | null {
    const marks = this.marks(index);
    if (!marks.length) return null;
    const left = Math.min(...marks.map((r) => r.left));
    const top = Math.min(...marks.map((r) => r.top));
    const right = Math.max(...marks.map((r) => r.right));
    const bottom = Math.max(...marks.map((r) => r.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  }

  /**
   * Ink box of each mark of ellipsis `index`: each dot, bullet or character.
   * For a single glyph like '…' the dots are found in the glyph itself.
   */
  marks(index = 0): DOMRect[] {
    const join = this.joins[index];
    const layout = this.lastRun?.marks;
    if (!join || !layout || index >= (this.current?.hidden.length ?? 0)) return [];
    if (layout.metrics.length !== join.marks.length) return [];
    if (layout.drawn) return join.marks.map((m) => m.getBoundingClientRect());
    const box = join.ellipsis.getBoundingClientRect();
    const baseline = box.top + layout.ascent;
    const boxes = join.marks.map((el, i) => {
      const r = el.getBoundingClientRect();
      const m = layout.metrics[i]!;
      return new DOMRect(r.left - m.left, baseline - m.ascent, m.left + m.right, m.ascent + m.descent);
    });
    const runs = layout.runs;
    if (boxes.length === 1 && runs && runs.length > 1) {
      const ink = boxes[0]!;
      return runs.map(([a, b]) => new DOMRect(ink.left + a, ink.top, b - a, ink.height));
    }
    return boxes;
  }

  /**
   * The elements drawing the marks of ellipsis `index`. A single glyph like
   * '…' is one element even though `marks()` reports its dots separately.
   */
  markElements(index = 0): HTMLElement[] {
    return index < (this.current?.hidden.length ?? 0) ? [...(this.joins[index]?.marks ?? [])] : [];
  }

  /** One box per rendered line of visible text, in viewport coordinates. */
  lineRects(): DOMRect[] {
    return Array.from(this.lineEl.getClientRects());
  }

  /** Element of grapheme `index` in glyph mode (null otherwise or when out of range). */
  glyph(index: number): HTMLSpanElement | null {
    return this.glyphEls[index] ?? null;
  }

  /** Ink box of grapheme `index` in glyph mode, or null when it isn't showing. */
  glyphInk(index: number): DOMRect | null {
    const el = this.glyphEls[index];
    if (!el?.isConnected || !this.lastRun) return null;
    return this.inkOf(this.lastRun, index, el.getBoundingClientRect());
  }

  /** Subscribe to visible-text changes. Returns an unsubscribe function. */
  onChange(fn: (change: ElideChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Called after every layout pass, including resizes that leave the visible
   * text as it was (the gaps still change). Returns an unsubscribe function.
   */
  onRender(fn: (state: ElideState) => void): () => void {
    this.renderListeners.add(fn);
    return () => this.renderListeners.delete(fn);
  }

  /** Change text and/or options and re-truncate. */
  update(options: ElideOptions): void {
    const { text, onChange, ...rest } = options;
    if (onChange) this.listeners.add(onChange);
    const before = this.settings;
    this.settings = { ...before, ...defined(rest) };
    const s = this.settings;
    if (markStyleFor(s) !== this.style && (s.ellipsis !== before.ellipsis || s.justify !== before.justify)) {
      for (const join of this.joins) this.fillMarks(join);
      // The old measurements describe marks that are gone.
      if (this.lastRun) this.lastRun.marks = null;
    }
    if (s.observe !== before.observe) this.observe(s.observe);
    if ((text !== undefined && text !== this.text) || s.glyphs !== before.glyphs) {
      this.setText(text ?? this.text);
      this.pendingReset = true;
      this.painted = null;
    } else {
      if (s.keep !== before.keep) this.setPins();
      if (s.position !== before.position) this.setLayout();
    }
    if (!s.title && this.titled) {
      this.element.removeAttribute('title');
      this.titled = false;
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
    byId.delete(this.id);
    this.listeners.clear();
    this.renderListeners.clear();
    this.element.removeAttribute('data-truncated');
    if (this.titled) this.element.removeAttribute('title');
    this.element.replaceChildren(...this.original);
  }

  // -------------------------------------------------------------------------
  // Setup

  private observe(on: boolean) {
    if (!on) {
      this.observer?.disconnect();
      this.observer = null;
      return;
    }
    if (this.observer || typeof ResizeObserver === 'undefined') return;
    this.lastWidth = -1;
    const host = this.element;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]!;
      const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      const height = entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      // Height changes are usually our own doing (fewer lines); only width matters.
      if (Math.abs(width - this.lastWidth) < 0.01) return;
      this.lastWidth = width;
      this.run('resize');
      // Truncating usually changes the height the observer just reported
      // (the old text was reflowed at the new width first). Left alone, that
      // is an undelivered notification, which browsers report as an error.
      // Look away until the next frame instead; picking up again reports the
      // same width, which is a no-op.
      const cs = getComputedStyle(host);
      const now =
        host.getBoundingClientRect().height -
        parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) -
        parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
      if (Math.abs(now - height) > 0.5) {
        observer.unobserve(host);
        requestAnimationFrame(() => {
          if (this.observer === observer) observer.observe(host);
        });
      }
    });
    this.observer = observer;
    observer.observe(host);
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
    this.setPins();
    this.setLayout();
  }

  private setPins() {
    this.pins = toGraphemeRanges(keepRanges(this.text, asArray(this.settings.keep)), this.offsets);
    for (const el of this.glyphEls) el.removeAttribute('data-fp-kept');
    for (const [s, e] of this.pins) for (let i = s; i < e; i++) this.glyphEls[i]?.setAttribute('data-fp-kept', '');
    this.hint = null;
  }

  private setLayout() {
    this.layout = layoutFor(this.g.length, asArray(this.settings.position));
    this.hint = null;
  }

  /** The join (ellipsis with its neighbouring glyphs) at `index`, created on demand. */
  private join(index: number): Join {
    let join = this.joins[index];
    if (!join) {
      const span = (attr: string) => {
        const el = document.createElement('span');
        el.setAttribute(attr, '');
        return el;
      };
      const el = span('data-fp-join');
      el.style.whiteSpace = 'nowrap';
      const ellipsis = span('data-fp-ellipsis');
      ellipsis.dataset.fpEllipsis = `${this.id}:${index}`;
      join = { el, before: span('data-fp-before'), ellipsis, after: span('data-fp-after'), marks: [] };
      el.append(join.before, ellipsis, join.after);
      this.fillMarks(join);
      this.joins[index] = join;
    }
    return join;
  }

  /** The marks being drawn: `options.ellipsis`, unless `justify: 'dots'` needs it split into dots. */
  get markStyle(): EllipsisStyle {
    return this.style;
  }

  private fillMarks(join: Join) {
    this.style = markStyleFor(this.settings);
    join.marks = buildMarks(this.style);
    join.ellipsis.replaceChildren(...join.marks);
  }

  private runEl(index: number): HTMLSpanElement {
    let el = this.runs[index];
    if (!el) {
      el = document.createElement('span');
      el.setAttribute('data-fp-run', '');
      this.runs[index] = el;
    }
    return el;
  }

  // -------------------------------------------------------------------------
  // Measuring

  private prepare(cs: CSSStyleDeclaration): Run {
    const host = this.element;
    const box = host.getBoundingClientRect();
    const left = box.left + host.clientLeft + parseFloat(cs.paddingLeft);
    const right = box.left + host.clientLeft + host.clientWidth - parseFloat(cs.paddingRight);
    return {
      font: fontOf(cs),
      letterSpacing: parseFloat(cs.letterSpacing) || 0,
      transform: cs.textTransform,
      left,
      right,
      marks: null,
    };
  }

  /** Mark measurements, read from the first ellipsis once it is in the DOM. */
  private markLayout(run: Run): MarkLayout {
    run.marks ??= layoutMarks(
      this.style,
      getComputedStyle(this.joins[0]!.ellipsis),
      this.joins.map((j) => j.marks),
    );
    return run.marks;
  }

  private glyphMetrics(run: Run, g: string): GlyphMetrics {
    const m = measure(run.font, applyTextTransform(g, run.transform));
    return run.letterSpacing ? { ...m, advance: m.advance + run.letterSpacing } : m;
  }

  private inkOf(run: Run, index: number, box: DOMRect): DOMRect {
    const g = this.g[index];
    if (g === undefined || isWhitespace(g)) return box;
    const m = this.glyphMetrics(run, g);
    const baseline = box.top + fontAscent(run.font);
    return new DOMRect(box.left - m.left, baseline - m.ascent, m.left + m.right, m.ascent + m.descent);
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

  /**
   * Rendered lines, top to bottom: vertical extent and right edge. A line can
   * come back as several boxes, so boxes sharing a top are merged.
   */
  private lineBoxes(): { top: number; bottom: number; right: number }[] {
    const lines: { top: number; bottom: number; right: number }[] = [];
    for (const r of this.lineEl.getClientRects()) {
      const line = lines.find((l) => Math.abs(l.top - r.top) < 1);
      if (line) {
        line.bottom = Math.max(line.bottom, r.bottom);
        line.right = Math.max(line.right, r.right);
      } else lines.push({ top: r.top, bottom: r.bottom, right: r.right });
    }
    return lines.sort((a, b) => a.top - b.top);
  }

  /** Index of the line ellipsis `index` is on, or -1. */
  private lineOf(index: number, lines: { top: number; bottom: number }[]): number {
    const r = this.joins[index]!.ellipsis.getBoundingClientRect();
    const middle = r.top + r.height / 2;
    return lines.findIndex((l) => middle >= l.top && middle <= l.bottom);
  }

  // -------------------------------------------------------------------------
  // Rendering

  /** Show graphemes [from, to) in `el`, touching the DOM as little as possible. */
  private fill(el: HTMLElement, from: number, to: number) {
    if (this.settings.glyphs) {
      const want = this.glyphEls.slice(from, to);
      const have = el.childNodes;
      if (have.length !== want.length || want.some((g, i) => have[i] !== g)) el.replaceChildren(...want);
      return;
    }
    const text = this.text.slice(this.offsets[from], this.offsets[to]);
    const node = el.firstChild;
    if (node instanceof Text && el.childNodes.length === 1) {
      if (node.data !== text) node.data = text;
    } else if (el.textContent !== text || el.childNodes.length > 1) {
      el.textContent = text;
    }
  }

  /**
   * Make `lineEl`'s children exactly `want`, moving as little as possible:
   * ellipses that stay keep their place, so their animations and hover
   * state survive resizing.
   */
  private reconcile(want: Node[]) {
    const parent = this.lineEl;
    want.forEach((node, i) => {
      const at = parent.childNodes[i];
      if (at !== node) parent.insertBefore(node, at ?? null);
    });
    while (parent.childNodes.length > want.length) parent.lastChild!.remove();
  }

  /** Full text, keeping a showing ellipsis in place but cancelled out by a negative margin. */
  private renderFull(run: Run) {
    const first = this.joins[0]!;
    if (!first.ellipsis.isConnected) {
      this.render(run, []);
      return;
    }
    const width = first.ellipsis.getBoundingClientRect().width;
    const n = this.g.length;
    this.lineEl.style.letterSpacing = '';
    this.reconcile([this.runEl(0), first.el]);
    this.fill(this.runEl(0), 0, n);
    this.fill(first.before, 0, 0);
    this.fill(first.after, n, n);
    first.ellipsis.style.marginLeft = '';
    first.ellipsis.style.marginRight = `${-width}px`;
  }

  /** Put the text into the DOM with `hidden` ranges replaced by ellipses. */
  private render(run: Run, hidden: readonly Range[]): GapPlan[] {
    const n = this.g.length;
    const m = hidden.length;
    this.lineEl.style.letterSpacing = '';
    const want: Node[] = [this.runEl(0)];
    for (let j = 0; j < m; j++) want.push(this.join(j).el, this.runEl(j + 1));
    this.reconcile(want);
    if (!m) {
      this.fill(this.runEl(0), 0, n);
      return [];
    }

    // Visible run r lies between ellipsis r - 1 and ellipsis r. Its first
    // glyph sits in the join before it and its last in the join after it,
    // so a line break can't separate an ellipsis from its neighbours.
    for (let r = 0; r <= m; r++) {
      let a = r === 0 ? 0 : hidden[r - 1]![1];
      let b = r === m ? n : hidden[r]![0];
      if (r > 0) {
        const take = a < b ? 1 : 0;
        this.fill(this.joins[r - 1]!.after, a, a + take);
        a += take;
      }
      if (r < m) {
        const take = a < b ? 1 : 0;
        this.fill(this.joins[r]!.before, b - take, b);
        b -= take;
      }
      this.fill(this.runEl(r), a, b);
    }

    const layout = this.markLayout(run);
    const target = resolveGap(this.settings.gap, layout.fontSize, () => layout.rhythm);
    const group = groupMetrics(layout, layout.inner);
    return hidden.map(([s, e], j) => {
      const before = s > 0 && !isWhitespace(this.g[s - 1]) ? this.glyphMetrics(run, this.g[s - 1]!) : null;
      const after = e < n && !isWhitespace(this.g[e]) ? this.glyphMetrics(run, this.g[e]!) : null;
      const plan = planGap(before, group, after, target);
      this.applySpacing(j, plan.marginLeft, plan.marginRight, layout.inner);
      return plan;
    });
  }

  private applySpacing(index: number, left: number, right: number, inner: readonly number[]) {
    const join = this.joins[index]!;
    const style = join.ellipsis.style;
    style.marginLeft = left ? `${left}px` : '';
    style.marginRight = right ? `${right}px` : '';
    join.marks.forEach((mark, i) => {
      if (i > 0) mark.style.marginLeft = inner[i - 1] ? `${inner[i - 1]}px` : '';
    });
  }

  /**
   * Stretch every line holding an ellipsis so it ends exactly at the right
   * edge, putting that line's slack into its ellipses. Lines are done top to
   * bottom; filling a line up to the edge keeps its line break where it was.
   */
  private justify(run: Run, plans: GapPlan[], lines: number): { gaps: GapInfo[]; slack: number } {
    const layout = run.marks!;
    const info = (plan: GapPlan, left: number, right: number, inner: readonly number[], extra: number, slack: number): GapInfo => ({
      ...plan,
      left: plan.naturalLeft === null ? null : plan.naturalLeft + left + extra,
      right: plan.naturalRight === null ? null : plan.naturalRight + right + extra,
      inner: layout.natural.map((v, i) => v + (inner[i] ?? 0) + extra),
      slack,
    });
    const infos = plans.map((p) => info(p, p.marginLeft, p.marginRight, layout.inner, 0, 0));

    // Group the ellipses by line, and total the room they could take in.
    const boxes = this.lineBoxes();
    const byLine = new Map<number, number[]>();
    plans.forEach((_, j) => {
      const line = this.lineOf(j, boxes);
      if (line >= 0) byLine.set(line, [...(byLine.get(line) ?? []), j]);
    });
    let room = 0;
    for (const line of byLine.keys()) room += Math.max(0, run.right - boxes[line]!.right);
    const mode = this.settings.justify;
    if (!mode || room <= 0) return { gaps: infos, slack: room };

    const holds = (line: number, ellipses: number[]) => {
      const m = this.measure(run);
      if (!m.ok || m.lines !== lines) return false;
      const now = this.lineBoxes();
      return ellipses.every((j) => this.lineOf(j, now) === line);
    };
    // Layout snaps each inline piece to 1/64 px, so filling a line exactly
    // can tip it over and wrap. Stay a hair inside, backing off if needed.
    const insets = [1 / 16, 0.25, 1];

    if (mode === 'spread' && lines === 1) {
      // Letter-spacing goes after every character; drawn marks get the same
      // as margins. Measure how the line grows rather than count characters.
      const apply = (ls: number) => {
        this.lineEl.style.letterSpacing = ls ? `${run.letterSpacing + ls}px` : '';
        if (layout.drawn) {
          plans.forEach((p, j) => this.applySpacing(j, p.marginLeft, p.marginRight + ls, layout.inner.map((v) => v + ls)));
        }
      };
      const start = boxes[0]!.right;
      for (const inset of insets) {
        const slack = room - inset;
        if (slack <= 0) break;
        const probe = slack / Math.max(1, this.lineEl.textContent?.length ?? 1);
        apply(probe);
        const grown = (this.lineBoxes()[0]?.right ?? start) - start;
        const ls = grown > 0 ? (probe * slack) / grown : 0;
        apply(ls);
        if (holds(0, plans.map((_, j) => j))) {
          return { gaps: plans.map((p) => info(p, p.marginLeft, p.marginRight, layout.inner, ls, slack / plans.length)), slack: room };
        }
      }
      apply(0);
      return { gaps: infos, slack: room };
    }

    const dots = mode === 'dots';
    const sides = (p: GapPlan) => (p.naturalLeft !== null ? 1 : 0) + (p.naturalRight !== null ? 1 : 0);
    const gapsOf = (p: GapPlan) => sides(p) + (dots ? layout.natural.length : 0);

    for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
      const ellipses = byLine.get(line)!;
      const lineRoom = run.right - (this.lineBoxes()[line]?.right ?? run.right);
      const total = ellipses.reduce((sum, j) => sum + gapsOf(plans[j]!), 0);
      if (lineRoom <= 0 || !total) continue;
      for (const inset of insets) {
        const slack = lineRoom - inset;
        if (slack <= 0) break;
        // Each ellipsis takes a share in proportion to the gaps it spreads it over.
        const tried = new Map<number, GapInfo>();
        for (const j of ellipses) {
          const p = plans[j]!;
          const count = gapsOf(p);
          if (!count) continue;
          const share = (slack * count) / total;
          let left = p.marginLeft;
          let right = p.marginRight;
          let inner = layout.inner;
          if (dots) {
            // Every gap of this ellipsis becomes the same width.
            const current = [
              ...(p.naturalLeft !== null ? [p.naturalLeft + p.marginLeft] : []),
              ...layout.natural.map((v, i) => v + layout.inner[i]!),
              ...(p.naturalRight !== null ? [p.naturalRight + p.marginRight] : []),
            ];
            const even = (current.reduce((sum, v) => sum + v, 0) + share) / count;
            if (p.naturalLeft !== null) left = even - p.naturalLeft;
            if (p.naturalRight !== null) right = even - p.naturalRight;
            inner = layout.natural.map((v) => even - v);
          } else {
            const each = share / count;
            if (p.naturalLeft !== null) left += each;
            if (p.naturalRight !== null) right += each;
          }
          this.applySpacing(j, left, right, inner);
          tried.set(j, info(p, left, right, inner, 0, share));
        }
        if (holds(line, ellipses)) {
          for (const [j, g] of tried) infos[j] = g;
          break;
        }
        for (const j of ellipses) this.applySpacing(j, plans[j]!.marginLeft, plans[j]!.marginRight, layout.inner);
      }
    }
    return { gaps: infos, slack: room };
  }

  // -------------------------------------------------------------------------

  private run(reason: ChangeReason) {
    const host = this.element;
    if (this.destroyed || !host.isConnected || host.getClientRects().length === 0) return;

    const run = this.prepare(getComputedStyle(host));
    const previous = this.current;
    const reset = this.pendingReset || !previous;
    this.pendingReset = false;

    // Where things were when last painted, for listeners that animate the
    // change. (Measuring now would see the old text reflowed at the new size.)
    const tracking = this.listeners.size > 0;
    const host0 = host.getBoundingClientRect();
    const moved = (r: DOMRect) => new DOMRect(r.x + host0.x, r.y + host0.y, r.width, r.height);
    const glyphsBefore = new Map<number, { box: DOMRect; ink: DOMRect }>();
    let marksBefore: DOMRect[][] = [];
    if (tracking && previous && !reset && this.painted) {
      marksBefore = this.painted.marks.map((marks) => marks.map(moved));
      for (const [i, g] of this.painted.glyphs) glyphsBefore.set(i, { box: moved(g.box), ink: moved(g.ink) });
    }
    this.lastRun = run;

    const n = this.g.length;
    const { snap, trim } = this.settings;

    // Trying the full text means cancelling the ellipsis, so only do it when
    // the text might fit: its glyph widths summed can't exceed the room on
    // all lines (with some leeway for kerning and collapsed spaces).
    let hidden: Range[] = [];
    let fit = { ok: false, lines: 0 };
    let width = 0;
    for (const g of this.g) width += this.glyphMetrics(run, g).advance;
    if (width <= (run.right - run.left) * this.settings.lines * 1.1 + 1) {
      this.renderFull(run);
      fit = this.measure(run);
    }
    let pins = this.pins;
    if (!fit.ok && n > 0) {
      const at = (k: number) => hiddenRanges(this.g, this.layout, k, pins, snap, trim);
      const fits = (k: number) => {
        this.render(run, at(k));
        return this.measure(run).ok;
      };
      // Kept parts that can't all fit give way, last first.
      while (pins.length && !fits(0)) pins = pins.slice(0, -1);
      const kept = searchMax(0, n - 1, fits, this.hint);
      this.hint = kept;
      hidden = at(kept);
    }
    const plans = this.render(run, hidden);
    fit = this.measure(run);
    const { gaps, slack } = hidden.length ? this.justify(run, plans, fit.lines) : { gaps: [], slack: 0 };

    const state = this.makeState(hidden, fit.lines, gaps, pins, slack);
    this.current = state;
    host.toggleAttribute('data-truncated', state.truncated);
    if (this.settings.title && state.truncated !== this.titled) {
      if (state.truncated) host.title = this.text;
      else host.removeAttribute('title');
      this.titled = state.truncated;
    }

    if (tracking) {
      this.recordPainted(run);
      this.emit(reason, previous, state, reset, glyphsBefore, marksBefore);
    }
    for (const fn of this.renderListeners) fn(state);
  }

  private emit(
    reason: ChangeReason,
    previous: ElideState | null,
    state: ElideState,
    reset: boolean,
    glyphsBefore: Map<number, { box: DOMRect; ink: DOMRect }>,
    marksBefore: DOMRect[][],
  ) {
    const same = previous && !reset && sameParts(previous.hidden, state.hidden);
    if (same && (reason === 'resize' || reason === 'refresh')) return;
    const n = state.length;

    const shown: number[] = [];
    const gone: number[] = [];
    const hiddenGlyphs = new Map<number, { box: DOMRect; ink: DOMRect }>();
    if (!reset && previous) {
      for (let i = 0; i < n; i++) {
        const was = isVisible(previous, i);
        const is = isVisible(state, i);
        if (is && !was) shown.push(i);
        else if (was && !is) {
          gone.push(i);
          const before = glyphsBefore.get(i);
          if (before) hiddenGlyphs.set(i, before);
        }
      }
    }
    const change: ElideChange = {
      reason,
      state,
      previous: reset ? null : previous,
      reset,
      shown,
      hidden: gone,
      hiddenGlyphs,
      glyphsBefore,
      marksBefore,
    };
    for (const fn of this.listeners) fn(change);
  }

  /** Remember glyph and mark positions, relative to the host, as they are about to be painted. */
  private recordPainted(run: Run) {
    const origin = this.element.getBoundingClientRect();
    const local = (r: DOMRect) => new DOMRect(r.x - origin.x, r.y - origin.y, r.width, r.height);
    const glyphs = new Map<number, { box: DOMRect; ink: DOMRect }>();
    if (this.settings.glyphs) {
      this.glyphEls.forEach((el, i) => {
        if (!el.isConnected) return;
        const box = el.getBoundingClientRect();
        glyphs.set(i, { box: local(box), ink: local(this.inkOf(run, i, box)) });
      });
    }
    const marks = (this.current?.hidden ?? []).map((_, j) => this.marks(j).map(local));
    this.painted = { glyphs, marks };
  }

  private makeState(hidden: readonly Range[], lines: number, gaps: GapInfo[], pins: readonly Range[] = this.pins, slack = 0): ElideState {
    const part = ([start, end]: Range): Part => ({
      start,
      end,
      text: this.text.slice(this.offsets[start], this.offsets[end]),
    });
    return {
      text: this.text,
      length: this.g.length,
      truncated: hidden.length > 0,
      hidden: hidden.map(part),
      kept: hidden.length ? pins.map(part) : [],
      lines,
      gaps,
      slack,
    };
  }
}

function sameParts(a: readonly Part[], b: readonly Part[]): boolean {
  return a.length === b.length && a.every((p, i) => p.start === b[i]!.start && p.end === b[i]!.end);
}

function isVisible(state: ElideState, i: number): boolean {
  for (const h of state.hidden) if (i >= h.start && i < h.end) return false;
  return true;
}

/** Truncate `element`'s text. Returns a live instance; call `destroy()` to undo. */
export function elide(element: HTMLElement, options?: ElideOptions): Elide {
  return new Elide(element, options);
}
