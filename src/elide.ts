import {
  type Layout,
  type Range,
  asArray,
  estimateKept,
  hiddenRanges,
  graphemeClasses,
  keepClasses,
  keepRanges,
  layoutFor,
  sameRanges,
  searchSteps,
  shownLength,
  giveWay,
  toGraphemeRanges,
  union,
  wordAround,
  wordsOf,
} from './cut.ts';
import { byId, forgetFound, hookDocument, instances } from './document.ts';
import { graphemes, isWhitespace } from './graphemes.ts';
import { type Marking, besideEllipsis, childRanges, fillGlyphs, fillPiece, markGlyphs, textAt } from './highlight.ts';
import { type Join, createJoin, drawMarks, fillWords, forgetWords, reconcile, setFindable, showHidden } from './join.ts';
import { type Justified, justify } from './justify.ts';
import { areaOf, boundsOf, contentEdges, holdStyle, indexAt, lineBoxes, lineSpan } from './lines.ts';
import { Phase, type Pass, lockstep } from './lockstep.ts';
import { type EllipsisStyle, type MarkLayout, groupMetrics, layoutMarks, markInk, markStyleFor, styleMarks, toPx } from './marks.ts';
import { type Chain, extentOf, markCopies, originals, readMarkup, speak } from './markup.ts';
import { type Font, type GapPlan, type GlyphMetrics, glyphIn, glyphInk, planGap, resolveGap, typesetOf } from './metrics.ts';
import {
  type ChangeReason,
  type ElideChange,
  type ElideOptions,
  type ElideState,
  type GapInfo,
  type Part,
  type Settings,
  DEFAULTS,
  changeOf,
  defined,
  isVisible,
} from './options.ts';
import { Predictor } from './predict.ts';
import { Suffix } from './suffix.ts';

interface Run {
  font: Font;
  letterSpacing: number;
  transform: string;
  /** The element's border box. */
  box: DOMRect;
  /** Content box edges and width. */
  left: number;
  right: number;
  width: number;
  marks: MarkLayout | null;
  /** Glyph metrics by grapheme, for this pass's font. */
  glyphs: Map<string, GlyphMetrics>;
  /** Running total of advances: `sums[i]` is the width of graphemes [0, i). */
  sums: Float64Array;
  /** The width of the suffix, as it shows when the pass starts. */
  suffix: number;
}

/** How the rendered text lies: whether it fits, on how many lines, and where it ends. */
interface Fit {
  ok: boolean;
  lines: number;
  end: number;
}

/** A finished pass, for its listeners. */
interface Painted {
  reason: ChangeReason;
  previous: ElideState | null;
  state: ElideState;
  reset: boolean;
  tracking: boolean;
  glyphsBefore: Map<number, { box: DOMRect; ink: DOMRect }>;
  marksBefore: DOMRect[][];
}

/** What expanded an instance: find in page, focus on a link it hid, or `expand()`. */
type Opener = 'find' | 'focus' | 'api';

const SR_ONLY =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;' +
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;user-select:none';

/** Whether wrapping can be turned off without touching how white space collapses. */
const WRAP_MODE = typeof CSS !== 'undefined' && CSS.supports('text-wrap-mode', 'nowrap');

let nextId = 1;

/** Passes waiting to run together (see `Elide.schedule`), and whether a flush is on its way. */
const queued = new Map<Elide, ChangeReason>();
let flushing = false;

/**
 * One ResizeObserver for every instance, so a resize re-truncates them all in
 * one batch, and one IntersectionObserver telling which are near the screen.
 */
let sharedObserver: ResizeObserver | null = null;
let nearObserver: IntersectionObserver | null = null;
const observed = new Map<Element, Elide>();

export class Elide {
  readonly element: HTMLElement;

  private settings: Settings;
  private readonly id = String(nextId++);
  /** The `text` option as given (undefined: the element's own content). */
  private source: string | Node | undefined;
  private text = '';
  private g: string[] = [];
  private offsets: number[] = [0];
  private glyphEls: HTMLSpanElement[] = [];
  private pins: Range[] = [];
  /** The classes `keep` gives each grapheme, or null. */
  private classes: (string | null)[] = [];
  /** The elements around each grapheme, or null; empty for plain text. */
  private chains: (Chain | null)[] = [];
  /** The screen-reader copy was made while the element was out of the document, so as plain text (see `speak`). */
  private unsaid = false;
  /** Holds `suffix`, after the line, while there is one. */
  private suffix: Suffix | null = null;
  /** What wants the hidden parts shown in place, if anything; and whether they are. */
  private opener: Opener | null = null;
  /** What to keep in sight for now, as if kept: what find in page found, or a focused link the cut hid. */
  private sought: { range: Range; by: 'find' | 'focus' } | null = null;
  private revealed = false;
  /** The element (in the original) of the focused link in the screen-reader copy. */
  private focused: Element | null = null;
  private layout: Layout = layoutFor(0, ['end']);
  private readonly original: Node[];
  private readonly srEl: HTMLSpanElement;
  private readonly lineEl: HTMLSpanElement;
  private readonly runs: HTMLSpanElement[] = [];
  private readonly joins: Join[] = [];
  private readonly listeners = new Set<(change: ElideChange) => void>();
  private readonly renderListeners = new Set<(state: ElideState) => void>();
  private lastWidth = -1;
  /** Far from the screen, as far as the IntersectionObserver knows (null until it has said). */
  private far: boolean | null = null;
  /** A pass put off while far from the screen (see `putOff`). */
  private owed: ChangeReason | null = null;
  /** Something is being read from the instance, so its passes can't wait. */
  private reading = false;
  /** How far the search's starting estimate was off last time, in graphemes; null before a first search. */
  private bias: number | null = null;
  private current: ElideState | null = null;
  private lastRun: Run | null = null;
  private pendingReset = false;
  /** The full text shows, as just set, so a pass can start from measuring it. */
  private fresh = true;
  private titled = false;
  private destroyed = false;
  private style: EllipsisStyle = '…';
  private painted: { glyphs: Map<number, { box: DOMRect; ink: DOMRect }>; marks: DOMRect[][] } | null = null;
  /** Gives the element its own inline height back, while we hold it. */
  private heightLock: (() => void) | null = null;
  /** Gives the element its own inline overflow back, while a put-off pass has it clipped. */
  private clipped: (() => void) | null = null;

  constructor(element: HTMLElement, options: ElideOptions = {}) {
    const { text, onChange, ...rest } = options;
    this.element = element;
    this.settings = { ...DEFAULTS, ...defined(rest) };
    this.original = Array.from(element.childNodes);

    this.srEl = document.createElement('span');
    this.srEl.setAttribute('data-fp-full', '');
    this.srEl.style.cssText = SR_ONLY;
    // Focus moving within the copy goes out and in again: only leaving it counts.
    this.srEl.addEventListener('focusin', (e) => this.focusOn(e.target));
    this.srEl.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      this.focusOn(next instanceof Node && this.srEl.contains(next) ? next : null);
    });
    this.lineEl = document.createElement('span');
    this.lineEl.setAttribute('data-fp-text', '');
    this.lineEl.setAttribute('aria-hidden', 'true');
    this.join(0);

    this.setText(text);
    element.replaceChildren(this.srEl, this.lineEl);
    this.setSuffix();
    // The full text until the first pass, which is scheduled (see `schedule`).
    // On one line, so that the first pass can wait (see `putOff`).
    this.showAll();
    if (WRAP_MODE) this.steadyLines('');
    this.clip(true);

    if (onChange) this.listeners.add(onChange);
    instances.add(this);
    // Turns off fallback.css's plain truncation.
    element.setAttribute('data-elide', '');
    byId.set(this.id, {
      instance: this,
      hidden: () => this.current?.hidden ?? [],
      found: (part, word) => this.foundIn(part, word),
      unfound: () => {
        if (this.opener === 'find') this.collapse();
        if (this.sought?.by === 'find') this.seek(null);
      },
    });
    hookDocument();
    this.schedule('init');
    this.observe(this.settings.observe);
  }

  /** Current settings. */
  get options(): Readonly<Settings> {
    return this.settings;
  }

  /** Current result. Before the first layout it describes the untruncated text. */
  get state(): ElideState {
    this.sync();
    return this.current ?? this.makeState([], 0, []);
  }

  get truncated(): boolean {
    this.sync();
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
    this.sync();
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
    return boundsOf(this.marks(index));
  }

  /**
   * The space ellipsis `index` takes up between the text before and after
   * it (its box plus the gaps either side, over the height of its line), in
   * viewport coordinates, or null. Where the hidden text would go, and a
   * generous hover target: see `ellipsisAt`.
   */
  ellipsisArea(index = 0): DOMRect | null {
    const e = this.ellipses[index];
    return e ? areaOf(e, this.lineRects()) : null;
  }

  /**
   * Index of the ellipsis whose area (see `ellipsisArea`) contains the point,
   * in client coordinates (e.g. a pointer event's), or -1. Unlike the
   * ellipsis element, which only spans its marks, this covers the gaps too.
   * `slop` widens every area by that many pixels on each side.
   */
  ellipsisAt(x: number, y: number, slop = 0): number {
    return indexAt(
      this.ellipses.map((_, i) => this.ellipsisArea(i)),
      x,
      y,
      slop,
    );
  }

  /**
   * Ink box of each mark of ellipsis `index`: each dot, bullet or character.
   * For a single glyph like '…' the dots are found in the glyph itself.
   */
  marks(index = 0): DOMRect[] {
    this.sync();
    const join = this.joins[index];
    const layout = this.lastRun?.marks;
    if (!join || !layout || index >= (this.current?.hidden.length ?? 0)) return [];
    return layout.metrics.length === join.marks.length ? markInk(layout, join.marks, join.ellipsis) : [];
  }

  /**
   * The elements drawing the marks of ellipsis `index`. A single glyph like
   * '…' is one element even though `marks()` reports its dots separately.
   */
  markElements(index = 0): HTMLElement[] {
    this.sync();
    return index < (this.current?.hidden.length ?? 0) ? [...(this.joins[index]?.marks ?? [])] : [];
  }

  /** One box per rendered line of visible text, in viewport coordinates. */
  lineRects(): DOMRect[] {
    this.sync();
    return lineBoxes(this.lineEl).map((l) => new DOMRect(l.left, l.top, l.right - l.left, l.bottom - l.top));
  }

  /** Element of grapheme `index` in glyph mode (null otherwise or when out of range). */
  glyph(index: number): HTMLSpanElement | null {
    return this.glyphEls[index] ?? null;
  }

  /**
   * Grapheme index (in the full text) of a DOM position in the element's
   * text, such as either end of a selection, or null when it isn't in the
   * visible text. A position inside an ellipsis stands for the start of what
   * it hides when `side` is 'start', for its end when 'end': a range that
   * touches an ellipsis covers all it hides, as copying it does.
   */
  graphemeAt(node: Node, offset: number, side: 'start' | 'end' = 'start'): number | null {
    this.sync();
    if (!this.current || !this.lineEl.contains(node)) return null;
    const j = this.ellipsisIndex(node);
    if (j >= 0) return side === 'start' ? this.current.hidden[j]!.start : this.current.hidden[j]!.end;
    const pieces = this.pieces();
    if (node instanceof Text) {
      const range = pieces.get(node) ?? (node.parentElement ? pieces.get(node.parentElement) : undefined);
      if (!range) return null;
      const at = this.offsets[range[0]]! + offset;
      let i = range[0];
      while (i < range[1] && this.offsets[i]! < at) i++;
      return i;
    }
    // An element: the boundary before its child at `offset`, or its end.
    const child = node.childNodes[offset];
    if (!child) return pieces.get(node)?.[1] ?? null;
    return (child instanceof Text ? pieces.get(node) : pieces.get(child))?.[0] ?? null;
  }

  /**
   * Where `render` puts the graphemes with `hidden` cut: visible run r lies
   * between ellipsis r - 1 and ellipsis r. Its first grapheme sits in the join
   * before it and its last in the join after it, so a line break can't part
   * an ellipsis from its neighbours (see `beside`). `shown` is the visible run
   * of each piece.
   */
  private layoutOf(hidden: readonly Range[]): { el: HTMLSpanElement; range: Range; shown: Range }[] {
    const n = this.g.length;
    const m = hidden.length;
    const out: { el: HTMLSpanElement; range: Range; shown: Range }[] = [];
    for (let r = 0; r <= m; r++) {
      let a = r === 0 ? 0 : hidden[r - 1]![1];
      let b = r === m ? n : hidden[r]![0];
      const shown: Range = [a, b];
      if (r > 0) {
        const take = besideEllipsis(this.marking, this.g, wordsOf(this.g), [a, b], a, this.settings.lines > 1);
        out.push({ el: this.join(r - 1).after, range: [a, a + take], shown });
        a += take;
      }
      if (r < m) {
        const take = besideEllipsis(this.marking, this.g, wordsOf(this.g), [a, b], b - 1, this.settings.lines > 1);
        out.push({ el: this.join(r).before, range: [b - take, b], shown });
        b -= take;
      }
      out.push({ el: this.runEl(r), range: [a, b], shown });
    }
    return out;
  }

  /** The cut showing now. */
  private get cut(): Range[] {
    return (this.current?.hidden ?? []).map((p): Range => [p.start, p.end]);
  }

  /** The graphemes each element of the visible text holds, as rendered now. */
  private pieces(): Map<Node, Range> {
    const hidden = this.current?.hidden ?? [];
    const map = new Map<Node, Range>([[this.lineEl, [0, this.g.length]]]);
    // An element holding text, and in text mode each text node and highlight in it.
    const hold = (el: HTMLElement, range: Range, glyphs = this.settings.glyphs) => {
      map.set(el, range);
      if (!glyphs) for (const [node, r] of childRanges(el, range, this.offsets)) map.set(node, r);
    };
    for (const { el, range } of this.layoutOf(this.cut)) hold(el, range);
    hidden.forEach((part, j) => {
      const join = this.joins[j]!;
      map.set(join.ellipsis, [part.start, part.end]);
      hold(join.found, [part.start, part.end], false);
      map.set(join.el, [map.get(join.before)![0], map.get(join.after)![1]]);
    });
    if (this.settings.glyphs) this.glyphEls.forEach((el, i) => map.set(el, [i, i + 1]));
    return map;
  }

  /**
   * Box of grapheme `index` as laid out, in viewport coordinates, or null
   * when it is hidden. Works in text mode too (measured with a Range), so a
   * tooltip can line its own copy of the text up with the original glyph by
   * glyph.
   */
  graphemeRect(index: number): DOMRect | null {
    this.sync();
    const n = this.g.length;
    if (index < 0 || index >= n || !this.current || !isVisible(this.current, index)) return null;
    if (this.settings.glyphs) {
      const el = this.glyphEls[index];
      return el?.isConnected ? el.getBoundingClientRect() : null;
    }
    const piece = this.layoutOf(this.cut).find(({ range: [a, b] }) => index >= a && index < b);
    const found = piece && textAt(piece.el, this.offsets[index]! - this.offsets[piece.range[0]]!);
    if (!found) return null;
    const [node, at] = found;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + (this.offsets[index + 1]! - this.offsets[index]!));
    return range.getBoundingClientRect();
  }

  /** Ink box of grapheme `index` in glyph mode, or null when it isn't showing. */
  glyphInk(index: number): DOMRect | null {
    this.sync();
    const el = this.glyphEls[index];
    if (!el?.isConnected || !this.lastRun) return null;
    return glyphInk(this.lastRun, this.g[index], el.getBoundingClientRect());
  }

  /** The classes `keep` gives grapheme `index` (space-separated), or null. */
  classOf(index: number): string | null {
    return this.classes[index] ?? null;
  }

  /** Whether what the ellipses hide is showing in their place (see `expand`). */
  get expanded(): boolean {
    this.sync();
    return this.revealed;
  }

  /**
   * Show what the ellipses hide in their place: all of the text, on as many
   * lines as it takes, until `collapse()`. The cut stays as it was (`state`),
   * so collapsing is quick. With `find: 'expand'`, find in page does this
   * when it finds hidden text, and so does focus reaching a link the cut hides.
   */
  expand(): void {
    this.open('api');
  }

  /** Put the ellipses back after `expand()` (or find in page) showed what they hide. */
  collapse(): void {
    if (this.opener === null || this.destroyed) return;
    this.opener = null;
    forgetFound(this);
    this.schedule('refresh');
  }

  private open(by: Opener) {
    if (this.destroyed) return;
    if (by !== 'find') forgetFound(this);
    if (this.opener !== null) {
      // Asked for outright, it stays open, whatever opened it first.
      if (by === 'api') this.opener = by;
      return;
    }
    this.opener = by;
    // A pass on its way ends expanded; otherwise the parts are shown now.
    this.sync();
    if (this.revealed || !this.current) return;
    this.reveal(true);
    this.current = { ...this.current, expanded: true };
    for (const fn of this.renderListeners) fn(this.current);
  }

  /** A link (or anything focusable) in the screen-reader copy took focus, or lost it (null). */
  private focusOn(target: EventTarget | null) {
    const focused = target instanceof Element ? (originals.get(target) ?? null) : null;
    if (focused === this.focused) return;
    this.focused = focused;
    const seen = this.markFocus();
    const expand = this.settings.find === 'expand';
    if (focused && !seen && expand) this.open('focus');
    else if (focused && !seen) this.seek(extentOf(this.chains, focused), 'focus');
    else if (!focused && this.opener === 'focus') this.collapse();
    else if (!focused && this.sought?.by === 'focus') this.seek(null);
  }

  /**
   * Find in page found text ellipsis `part` hides, starting in `word` when
   * that's known: expand, or keep the word in sight.
   */
  private foundIn(part: number, word: Range | null) {
    if (this.settings.find === 'expand') return this.open('find');
    // The browser shows the hidden text it found once this returns: put it
    // back before that's painted, with the word showing in the line instead.
    const hidden = this.current?.hidden[part];
    const range = word ?? (hidden ? wordAround(wordsOf(this.g), hidden.start) : null);
    for (const join of this.joins) forgetWords(join);
    requestAnimationFrame(() => this.seek(range, 'find'));
  }

  /** Keep `range` in sight for now (see `sought`), or stop (null). */
  private seek(range: Range | null, by: 'find' | 'focus' = 'find') {
    if (this.destroyed) return;
    this.sought = range ? { range, by } : null;
    const match = this.marking.match;
    markGlyphs(this.glyphEls, 'data-fp-match', match ? [match] : []);
    this.bias = null;
    this.schedule('refresh');
  }

  /**
   * Mark the copies in the line of the focused element `data-fp-focus`, so
   * CSS can draw a focus ring there. Returns whether one of them shows.
   */
  private markFocus(): boolean {
    return markCopies(this.lineEl, this.focused, 'data-fp-focus').some((el) => this.revealed || !el.closest('[data-fp-found]'));
  }

  /** Subscribe to visible-text changes. Returns an unsubscribe function. */
  onChange(fn: (change: ElideChange) => void): () => void {
    const first = this.listeners.size === 0;
    this.listeners.add(fn);
    // Passes record what they paint only for listeners; the next change animates from here.
    if (first && this.current && this.lastRun) this.recordPainted(this.lastRun);
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
    const restyled = markStyleFor(s) !== this.style && (s.ellipsis !== before.ellipsis || s.justify !== before.justify);
    if (restyled || s.lines > 1 !== before.lines > 1) {
      for (const join of this.joins) this.fillMarks(join);
      // The old measurements describe marks that are gone.
      if (this.lastRun) this.lastRun.marks = null;
    }
    if (s.observe !== before.observe) this.observe(s.observe);
    if (s.lines !== before.lines) this.bias = null;
    if (s.suffix !== before.suffix) this.setSuffix();
    if ((text !== undefined && text !== this.source) || s.glyphs !== before.glyphs) {
      this.sought = null;
      this.setText(text ?? this.source);
      this.showAll();
      this.fresh = true;
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
    this.schedule('update');
  }

  /** Re-measure and re-truncate, e.g. after a style change the observer can't see. */
  refresh(reason: ChangeReason = 'refresh'): void {
    this.schedule(reason);
  }

  /** Stop observing and restore the element's original content. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observe(false);
    queued.delete(this);
    instances.delete(this);
    byId.delete(this.id);
    this.listeners.clear();
    this.renderListeners.clear();
    forgetFound(this);
    this.unlockHeight();
    this.clip(false);
    this.element.removeAttribute('data-truncated');
    this.element.removeAttribute('data-elide');
    this.element.removeAttribute('data-fp-expanded');
    if (this.titled) this.element.removeAttribute('title');
    this.element.replaceChildren(...this.original);
    this.suffix?.giveBack(true);
  }

  // -------------------------------------------------------------------------
  // Setup

  private observe(on: boolean) {
    const host = this.element;
    if (!on) {
      if (observed.get(host) !== this) return;
      observed.delete(host);
      sharedObserver?.unobserve(host);
      nearObserver?.unobserve(host);
      this.far = null;
      if (this.owed) this.schedule(this.owed);
      return;
    }
    if (observed.get(host) === this || typeof ResizeObserver === 'undefined') return;
    if (!sharedObserver) {
      sharedObserver = new ResizeObserver((entries) => Elide.resized(entries));
      // Not bubbling, but it can be caught on its way down.
      document.addEventListener('contentvisibilityautostatechange', (e) => Elide.unskipped(e), true);
    }
    observed.set(host, this);
    sharedObserver.observe(host);
    if (typeof IntersectionObserver === 'undefined') return;
    nearObserver ??= new IntersectionObserver((entries) => Elide.neared(entries), { rootMargin: '100%' });
    nearObserver.observe(host);
  }

  /** Read the text, and its elements, from `source`: a string, a node, or (undefined) the element's own content. */
  private setText(source: string | Node | undefined) {
    this.source = source;
    const suffix = this.settings.suffix;
    const { text, chains } =
      typeof source === 'string'
        ? { text: source, chains: null }
        : readMarkup(source === undefined ? this.original : [source], typeof suffix === 'object' ? suffix : null);
    this.text = text;
    this.g = graphemes(text);
    this.offsets = [0];
    for (const s of this.g) this.offsets.push(this.offsets[this.offsets.length - 1]! + s.length);
    this.chains = chains ? this.g.map((_, i) => chains[this.offsets[i]!] ?? null) : [];
    this.glyphEls = this.settings.glyphs
      ? this.g.map((s, i) => {
          const el = document.createElement('span');
          el.setAttribute('data-fp-glyph', String(i));
          el.textContent = s;
          return el;
        })
      : [];
    this.unsaid = !speak(this.srEl, this.element, this.g, this.chains) && !this.element.isConnected;
    this.setPins();
    this.setLayout();
  }

  /** Put `suffix` after the line (see `Suffix`). */
  private setSuffix() {
    const content = this.settings.suffix;
    if (content !== null && content !== '') {
      (this.suffix ??= new Suffix(this.element, () => this.refresh())).fill(content);
      return;
    }
    this.suffix?.giveBack(false);
    this.suffix?.el.remove();
    this.suffix = null;
  }

  private setPins() {
    const keep = asArray(this.settings.keep);
    this.pins = toGraphemeRanges(keepRanges(this.text, keep), this.offsets);
    this.classes = graphemeClasses(keepClasses(this.text, keep), this.offsets);
    markGlyphs(this.glyphEls, 'data-fp-kept', this.pins);
    this.glyphEls.forEach((el, i) => (el.className = this.classes[i] ?? ''));
    this.bias = null;
  }

  private setLayout() {
    this.layout = layoutFor(this.g.length, asArray(this.settings.position));
    this.bias = null;
  }

  /** The join (ellipsis with its neighbouring glyphs) at `index`, created on demand. */
  private join(index: number): Join {
    let join = this.joins[index];
    if (!join) {
      join = createJoin(this.id, index, this.settings.find !== false);
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
    // Only text that can wrap needs gluing: Firefox letter-spaces the joiners.
    drawMarks(join, this.style, this.settings.lines > 1);
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

  /**
   * When the element narrows, the browser lays out what's there at the new
   * width before the observer lets us re-truncate it. A line justified to
   * fill the old width wraps then, and the element grows for that one
   * (unpainted) layout, which is enough for a browser anchoring the scroll
   * position to react: a scroll event on every frame of a shrink, even far
   * off screen. So a single line never wraps (it overflows for that moment
   * instead, and fitting checks the right edge anyway), and while truncated
   * text fills its lines, the element's height is held between passes.
   */
  private steadyLines(whiteSpace: string) {
    const single = this.settings.lines <= 1;
    if (WRAP_MODE) this.lineEl.style.setProperty('text-wrap-mode', single ? 'nowrap' : '');
    else this.lineEl.style.whiteSpace = single && whiteSpace === 'normal' ? 'nowrap' : '';
  }

  /** Hold the element's height at `height`, its computed height. */
  private lockHeight(height: string) {
    if (height.endsWith('px')) this.heightLock = holdStyle(this.element, 'height', height);
  }

  private unlockHeight() {
    this.heightLock?.();
    this.heightLock = null;
  }

  /**
   * Clip the element while a pass is put off: what it shows meanwhile (the
   * full text, or a cut for another width) can overflow, and when it comes
   * into view faster than the observers can tell, it is painted once like that.
   */
  private clip(on: boolean) {
    if (on === (this.clipped !== null)) return;
    this.clipped?.();
    this.clipped = on ? holdStyle(this.element, 'overflow', 'clip') : null;
  }

  /** What a pass needs to know about the element. Reads layout. */
  private prepare(cs: CSSStyleDeclaration): Run {
    const box = this.element.getBoundingClientRect();
    const { left, right } = contentEdges(this.element, cs, box);
    return {
      ...typesetOf(cs),
      box,
      left,
      right,
      // As a ResizeObserver reports it.
      width: right - left,
      marks: null,
      sums: new Float64Array(this.g.length + 1),
      suffix: this.suffix?.measure() ?? 0,
    };
  }

  /** Mark measurements, read from the first ellipsis' computed style. */
  private markLayout(run: Run): MarkLayout {
    const first = this.joins[0]!;
    run.marks ??= layoutMarks(this.style, getComputedStyle(first.ellipsis), first.marks.length);
    return run.marks;
  }

  /**
   * The cuts that save room. Hiding text no wider than the ellipsis that
   * stands in for it (its marks and the gaps either side, as `render` will
   * plan them) only adds an ellipsis. (The first probe of a pass, before an
   * ellipsis has been laid out, can't tell; the search corrects for that.)
   */
  private worthCutting(run: Run, hidden: Range[]): Range[] {
    if (hidden.length === 0 || (!run.marks && !this.joins[0]?.ellipsis.isConnected)) return hidden;
    const layout = this.markLayout(run);
    const target = resolveGap(this.settings.gap, layout.fontSize, () => layout.rhythm);
    const group = groupMetrics(layout, layout.inner);
    return hidden.filter(([s, e]) => {
      const width = run.sums[e]! - run.sums[s]!;
      const plan = planGap(this.neighbour(run, s - 1), group, this.neighbour(run, e), target);
      return width > plan.marginLeft + group.advance + plan.marginRight;
    });
  }

  /** The glyph at `i` as an ellipsis' neighbour: null for none, or whitespace (it has no ink). */
  private neighbour(run: Run, i: number): GlyphMetrics | null {
    const g = this.g[i];
    return g !== undefined && !isWhitespace(g) ? glyphIn(run, g) : null;
  }

  /** The line and the suffix after it: what has to fit. */
  private lineParts(): HTMLElement[] {
    return this.suffix ? [this.lineEl, this.suffix.el] : [this.lineEl];
  }

  /** Does the rendered text fit? Reads layout. */
  private measure(run: Run): Fit {
    const { lines, inside, end } = lineSpan(this.lineParts(), run.left, run.right);
    return { ok: inside && lines <= this.settings.lines, lines, end };
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
  /** `shown`: the visible run it's part of, which a highlight may go on into. */
  private fill(el: HTMLElement, from: number, to: number, shown: Range = [0, this.g.length]) {
    if (this.settings.glyphs) fillGlyphs(el, this.glyphEls, this.chains, [from, to]);
    else fillPiece(el, this.g, this.marking, [from, to], shown);
  }

  private get marking(): Marking {
    const sought = this.sought;
    return { classes: this.classes, chains: this.chains, match: sought?.by === 'find' ? sought.range : null };
  }

  /** Show the suffix as the text is (or isn't) truncated. */
  private suffixFor(truncated: boolean) {
    this.suffix?.show(truncated || this.settings.showSuffix === 'always');
  }

  /**
   * Put the text each ellipsis hides in it, for find in page to find: word by
   * word to keep a match in sight (see `fillWords`), or as it would show
   * expanded (see `reveal`).
   */
  private fillFound(hidden: readonly Range[]) {
    const { find } = this.settings;
    this.joins.forEach((join, j) => {
      const part = hidden[j] ?? [0, 0];
      setFindable(join, find !== false);
      if (find === 'keep') fillWords(join, this.g, wordsOf(this.g), part);
      else fillPiece(join.found, this.g, this.marking, part, [0, this.g.length]);
    });
  }

  /**
   * Show what the first `count` ellipses hide in their place, the text
   * wrapping onto as many lines as it takes (`on`), or put the ellipses back.
   */
  private reveal(on: boolean, hidden: readonly Range[] = this.cut) {
    this.revealed = on;
    this.joins.forEach((join, j) => {
      const part = hidden[j];
      const shown = on && !!part;
      // Found word by word: shown, it's as the text would show.
      if (shown && this.settings.find === 'keep') {
        forgetWords(join);
        fillPiece(join.found, this.g, this.marking, part, [0, this.g.length]);
      }
      showHidden(join, shown, this.settings.find !== false);
    });
    // A path or a URL has nowhere to wrap: it breaks where it must.
    this.lineEl.style.overflowWrap = on ? 'break-word' : '';
    if (on) {
      this.lineEl.style.letterSpacing = '';
      if (WRAP_MODE) this.lineEl.style.setProperty('text-wrap-mode', '');
      else this.lineEl.style.whiteSpace = '';
      this.unlockHeight();
    }
    this.element.toggleAttribute('data-fp-expanded', on);
  }

  /**
   * The full text. The first ellipsis stays in the DOM, out of sight, so a
   * pass can read its style along with everything else it reads first.
   */
  private showAll() {
    const first = this.joins[0]!;
    first.el.style.display = 'none';
    first.el.style.position = '';
    reconcile(this.lineEl, [this.runEl(0), first.el]);
    this.fill(this.runEl(0), 0, this.g.length);
    this.fill(first.before, 0, 0);
    this.fill(first.after, 0, 0);
    this.suffixFor(false);
  }

  /**
   * Full text, keeping a showing ellipsis in the DOM (hiding it would restart
   * its animations) but out of the flow, so the text is measured alone.
   * (Cancelling its width with a margin goes wrong once trying a cut in the
   * same pass has spaced it differently.)
   */
  private renderFull(run: Run) {
    const first = this.joins[0]!;
    if (first.el.style.display === 'none' || !first.ellipsis.isConnected) {
      this.render(run, []);
      return;
    }
    const n = this.g.length;
    this.lineEl.style.letterSpacing = '';
    reconcile(this.lineEl, [this.runEl(0), first.el]);
    this.fill(this.runEl(0), 0, n);
    this.fill(first.before, 0, 0);
    this.fill(first.after, n, n);
    first.el.style.position = 'absolute';
    this.suffixFor(false);
  }

  /** Put the text into the DOM with `hidden` ranges replaced by ellipses. */
  private render(run: Run, hidden: readonly Range[]): GapPlan[] {
    const m = hidden.length;
    this.lineEl.style.letterSpacing = '';
    if (m === 0) {
      this.showAll();
      return [];
    }
    const want: Node[] = [this.runEl(0)];
    for (let j = 0; j < m; j++) want.push(this.join(j).el, this.runEl(j + 1));
    this.joins[0]!.el.style.display = '';
    this.joins[0]!.el.style.position = '';
    reconcile(this.lineEl, want);
    this.suffixFor(true);
    for (const { el, range, shown } of this.layoutOf(hidden)) this.fill(el, range[0], range[1], shown);

    const layout = this.markLayout(run);
    if (layout.css !== null) for (let j = 0; j < m; j++) styleMarks(this.joins[j]!.marks, layout.css);
    const target = resolveGap(this.settings.gap, layout.fontSize, () => layout.rhythm);
    const group = groupMetrics(layout, layout.inner);
    return hidden.map(([s, e], j) => {
      const plan = planGap(this.neighbour(run, s - 1), group, this.neighbour(run, e), target);
      this.applySpacing(j, plan.marginLeft, plan.marginRight, layout.inner);
      return plan;
    });
  }

  private applySpacing(index: number, left: number, right: number, inner: readonly number[]) {
    const join = this.joins[index]!;
    const style = join.ellipsis.style;
    style.marginLeft = left !== 0 ? `${left}px` : '';
    style.marginRight = right !== 0 ? `${right}px` : '';
    join.marks.forEach((mark, i) => {
      if (i > 0) {
        const before = inner[i - 1] ?? 0;
        mark.style.marginLeft = before !== 0 ? `${before}px` : '';
      }
    });
  }

  /** The rendered text, for `justify` to fill its lines. */
  private justified(run: Run, plans: GapPlan[], lines: number, hidden: readonly Range[]): Justified {
    return {
      mode: this.settings.justify,
      maxGap: this.settings.maxGap === null ? null : toPx(this.settings.maxGap, run.marks!.fontSize),
      lines,
      sure: this.settings.lines <= 1 && WRAP_MODE,
      right: run.right,
      layout: run.marks!,
      plans,
      characters: shownLength(this.offsets, hidden, this.joins[0]?.marks.length ?? 0),
      boxes: () => lineBoxes(...this.lineParts()),
      lineOf: (j, boxes) => this.lineOf(j, boxes),
      fits: () => this.measure(run),
      space: (j, left, right, inner) => this.applySpacing(j, left, right, inner),
      spread: (ls) => (this.lineEl.style.letterSpacing = ls !== 0 ? `${run.letterSpacing + ls}px` : ''),
    };
  }

  // -------------------------------------------------------------------------
  // Scheduling

  /**
   * Run a pass in a microtask, together with every other instance's, or as
   * soon as anything is read from this one.
   */
  private schedule(reason: ChangeReason) {
    if (this.putOff(reason, this.far === true)) {
      this.clip(true);
      return;
    }
    if (!queued.has(this)) queued.set(this, reason);
    if (flushing) return;
    flushing = true;
    queueMicrotask(() => Elide.flush());
  }

  /** Bring a scheduled pass forward: anything read from the instance is up to date. */
  private sync() {
    if (this.owed && !queued.has(this)) queued.set(this, this.owed);
    if (!queued.has(this)) return;
    this.reading = true;
    try {
      Elide.flush();
    } finally {
      this.reading = false;
    }
  }

  /**
   * Whether a pass can wait because the element is `far` from the screen
   * (more than a screen away): a first pass, or one for a new width or font,
   * when what is showing meanwhile can't change the element's height. One
   * line never wraps; more lines are held at their height once truncated. In
   * a long table, that is most rows. The pass runs once the element comes
   * near the screen, or as soon as anything is read from the instance.
   */
  private putOff(reason: ChangeReason, far: boolean): boolean {
    if (!far || this.reading || !nearObserver || observed.get(this.element) !== this) return false;
    if (reason !== 'init' && reason !== 'resize' && reason !== 'fonts') return false;
    if (this.settings.lines > 1 ? this.heightLock === null : reason === 'init' && !WRAP_MODE) return false;
    this.owed ??= reason;
    return true;
  }

  /**
   * Content that `content-visibility: auto` stopped skipping: passes that
   * waited for it (see `pass`) run now. The ResizeObserver often can't tell:
   * the size it last reported is still right.
   */
  private static unskipped(event: Event) {
    if (!(event.target instanceof Element) || ('skipped' in event && event.skipped === true)) return;
    for (const line of event.target.querySelectorAll('[data-fp-text]')) {
      const instance = line.parentElement ? observed.get(line.parentElement) : undefined;
      if (instance?.owed) instance.schedule(instance.owed);
    }
  }

  /** The shared IntersectionObserver: passes put off run as their elements come near. */
  private static neared(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const instance = observed.get(entry.target);
      if (!instance) continue;
      instance.far = !entry.isIntersecting;
      if (!instance.far && instance.owed) instance.schedule(instance.owed);
    }
  }

  private static flush() {
    flushing = false;
    const batch = [...queued];
    queued.clear();
    Elide.runAll(batch);
  }

  /** Run the passes in lockstep, then tell each instance's listeners. */
  private static runAll(batch: [Elide, ChangeReason][]) {
    if (batch.length === 0) return;
    const { results, failed } = lockstep(batch.map(([instance, reason]) => instance.pass(reason)));
    results.forEach((result, i) => result && batch[i]![0].finish(result));
    if (failed) throw failed.error;
  }

  /** The shared ResizeObserver: re-truncates every resized instance in one batch. */
  private static resized(entries: ResizeObserverEntry[]) {
    const heights = new Map<Elide, number>();
    for (const entry of entries) {
      const instance = observed.get(entry.target);
      if (!instance) continue;
      const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      // Height changes are usually our own doing (fewer lines); only width matters.
      if (Math.abs(width - instance.lastWidth) < 0.01 && !instance.owed) continue;
      if (instance.putOff('resize', instance.far === true)) {
        instance.clip(true);
        continue;
      }
      heights.set(instance, entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    }
    if (heights.size === 0) return;
    const batch = [...queued];
    queued.clear();
    for (const instance of heights.keys()) if (!batch.some(([i]) => i === instance)) batch.push([instance, instance.owed ?? 'resize']);
    Elide.runAll(batch);
    // Truncating usually changes the height the observer just reported (the
    // old text was reflowed at the new width first). Left alone, that is an
    // undelivered notification, which browsers report as an error. Look away
    // until the next frame instead; picking up again reports the same width,
    // which is a no-op.
    for (const [instance, height] of heights) {
      const host = instance.element;
      if (observed.get(host) !== instance) continue;
      const cs = getComputedStyle(host);
      const now =
        host.getBoundingClientRect().height -
        parseFloat(cs.paddingTop) -
        parseFloat(cs.paddingBottom) -
        parseFloat(cs.borderTopWidth) -
        parseFloat(cs.borderBottomWidth);
      if (Math.abs(now - height) <= 0.5) continue;
      sharedObserver?.unobserve(host);
      requestAnimationFrame(() => {
        if (observed.get(host) === instance) sharedObserver?.observe(host);
      });
    }
  }

  /**
   * One layout pass. It starts out reading layout and yields whenever it
   * switches between reading and writing, so `lockstep` can run many side
   * by side.
   */
  private *pass(reason: ChangeReason): Pass<Painted | null> {
    const phase = new Phase();
    const host = this.element;
    this.owed = null;
    if (this.destroyed || !host.isConnected) return null;
    // Expanded text wraps as it likes: only a change of text or options needs a pass.
    if (this.opener !== null && (reason === 'resize' || reason === 'fonts')) return null;
    // In content that `content-visibility: auto` skips, reading layout lays
    // it out there and then, one element at a time. Wait until it is
    // rendered: the ResizeObserver reports it then.
    if (!this.reading && observed.get(host) === this && !host.checkVisibility?.({ contentVisibilityAuto: true })) {
      this.owed = reason;
      yield* phase.write();
      this.clip(true);
      return null;
    }
    if (host.getClientRects().length === 0) return null;

    const cs = getComputedStyle(host);
    const run = this.prepare(cs);
    this.lastWidth = run.width;
    // Once the IntersectionObserver has had its say, it decides: going by
    // the box instead can disagree right at the edge, and then nothing would
    // run the pass when it comes near (the observer has nothing new to say).
    const box = run.box;
    const far =
      this.far ?? (box.bottom < -innerHeight || box.top > 2 * innerHeight || box.right < -innerWidth || box.left > 2 * innerWidth);
    if (this.putOff(reason, far)) {
      yield* phase.write();
      this.clip(true);
      return null;
    }
    const previous = this.current;
    const reset = this.pendingReset || !previous;
    const first = this.joins[0]!;
    if (first.ellipsis.isConnected) this.markLayout(run);
    const whiteSpace = cs.whiteSpace;
    // On one line, what is showing can be the first measurement to judge
    // cuts by (see `Predictor`): the cut last rendered, less the room
    // justifying added, or before the first pass, the full text.
    const predictable =
      this.settings.lines <= 1 &&
      WRAP_MODE &&
      this.settings.justify !== 'spread' &&
      cs.direction === 'ltr' &&
      /^(start|left|justify)$/.test(cs.textAlign) &&
      // A highlight or an element may change the font, which the glyph widths don't know.
      this.classes.every((c) => c === null) &&
      this.chains.length === 0 &&
      this.suffix === null &&
      !this.revealed;
    let base: { cut: Range[]; end: number } | null = null;
    // (Or the full text, when it has just been set and shows in full.)
    const fresh = this.fresh;
    if (predictable && this.g.length > 0 && (fresh || ((reason === 'resize' || reason === 'init') && !this.pendingReset))) {
      const { end } = lineSpan([this.lineEl], run.left, run.right);
      const added = fresh ? 0 : (previous?.gaps.reduce((sum, g) => sum + g.slack, 0) ?? 0);
      base = { cut: fresh ? [] : (previous?.hidden.map((p): Range => [p.start, p.end]) ?? []), end: end - added };
    }
    // Trying cuts that don't fit wraps the text, so the element grows (or
    // overflows) for a moment. Nobody sees it, but measuring lays it out, and
    // a browser that anchors the scroll position (most do) reacts to it,
    // firing a scroll event on every pass: on every frame of a resize, even
    // far off screen. Holding the element's height and clipping its overflow
    // while fitting keeps all of that inside. (Neither changes where anything
    // inside is laid out, and nothing paints before they're restored.)
    const hold = cs.display !== 'inline' && cs.height.endsWith('px');
    const height = cs.height;

    yield* phase.write();
    this.pendingReset = false;
    this.fresh = false;
    this.steadyLines(whiteSpace);
    this.clip(false);
    if (this.revealed) this.reveal(false);
    if (this.unsaid) {
      speak(this.srEl, this.element, this.g, this.chains);
      this.unsaid = false;
    }

    // Where things were when last painted, for listeners that animate the
    // change. (Measuring now would see the old text reflowed at the new size.)
    const tracking = this.listeners.size > 0;
    const moved = (r: DOMRect) => new DOMRect(r.x + run.box.x, r.y + run.box.y, r.width, r.height);
    const glyphsBefore = new Map<number, { box: DOMRect; ink: DOMRect }>();
    let marksBefore: DOMRect[][] = [];
    if (tracking && previous && !reset && this.painted) {
      marksBefore = this.painted.marks.map((marks) => marks.map(moved));
      for (const [i, g] of this.painted.glyphs) glyphsBefore.set(i, { box: moved(g.box), ink: moved(g.ink) });
    }
    this.lastRun = run;

    const n = this.g.length;
    const { snap, trim } = this.settings;
    let hidden: Range[] = [];
    let fit: Fit = { ok: false, lines: 0, end: 0 };
    const pinned = () => (this.sought ? union([this.sought.range, ...this.pins]) : this.pins);
    let pins = pinned();
    let gaps: GapInfo[] = [];
    let slack = 0;
    let plans: GapPlan[] = [];

    const held = hold ? [holdStyle(host, 'height', height), holdStyle(host, 'overflow', 'clip')] : [];
    try {
      for (let i = 0; i < n; i++) run.sums[i + 1] = run.sums[i]! + glyphIn(run, this.g[i]!).advance;
      const layout = run.marks;
      let predictor: Predictor | null = null;
      if (base && layout) {
        const model = {
          sums: run.sums,
          neighbour: (i: number) => this.neighbour(run, i),
          group: groupMetrics(layout, layout.inner),
          target: resolveGap(this.settings.gap, layout.fontSize, () => layout.rhythm),
        };
        predictor = new Predictor(model, n, run.right, 0.1 * layout.fontSize + 0.25);
        predictor.saw(base.cut, base.end);
      }
      // Whether a cut was judged without being rendered, and so has yet to
      // be checked; and the cut last rendered and measured.
      let judged = false;
      let tried: Range[] | null = null;
      const at = (k: number) => this.worthCutting(run, hiddenRanges(this.g, this.layout, k, pins, snap, trim));
      const attempt = function* (this: Elide, cut: Range[]): Generator<void, boolean, void> {
        const sure = predictor?.fits(cut) ?? null;
        if (sure !== null) {
          judged = true;
          return sure;
        }
        yield* phase.write();
        tried = cut;
        if (cut.length === 0) this.renderFull(run);
        else this.render(run, cut);
        yield* phase.read();
        fit = this.measure(run);
        predictor?.saw(cut, fit.end);
        return fit.ok;
      };
      // A judgement shouldn't be wrong, but if the final measurement says it
      // was, the cut is found again without judging.
      for (;;) {
        pins = pinned();
        hidden = [];
        // Trying the full text means cancelling the ellipsis, so only do it
        // when the text might fit: its glyph widths summed can't exceed the
        // room on all lines (with some leeway for kerning and collapsed spaces).
        const room = (run.right - run.left) * this.settings.lines - run.suffix;
        const full = run.sums[n]! <= room * 1.1 + 1 && (yield* attempt.call(this, []));
        if (!full && n > 0) {
          // Kept parts that can't all fit give way, last first.
          while (pins.length > 0 && !(yield* attempt.call(this, at(0)))) pins = giveWay(pins, this.sought?.range ?? null);
          yield* phase.write();
          // Where the search starts: what the canvas widths say fits. Kerning,
          // wrapping and rounding make that a guess, but a steady one, so it
          // is shifted by how far off it was last time. (Until there is a last
          // time, a guess at several lines ignores the room wrapping wastes,
          // which is too far off to start from.)
          const mark = layout ? groupMetrics(layout, layout.inner).advance : 0;
          const guess = estimateKept(this.g, this.layout, pins, snap, trim, run.sums, mark, room);
          const bias = this.bias ?? (this.settings.lines > 1 ? null : 0);
          // One past the expected answer first: when the expectation holds,
          // the last probe is the answer, already rendered and measured.
          const search = searchSteps(0, n - 1, bias === null ? null : Math.max(0, Math.min(n - 1, guess + bias + 1)));
          let step = search.next();
          while (!step.done) step = search.next(yield* attempt.call(this, at(step.value)));
          this.bias = step.value - guess;
          hidden = at(step.value);
        }
        const measured = fit.ok && tried !== null && sameRanges(tried, hidden);
        yield* phase.write();
        plans = this.render(run, hidden);
        if (!measured) {
          yield* phase.read();
          fit = this.measure(run);
        }
        if (fit.ok || !judged) break;
        predictor = null;
        judged = false;
      }
      if (hidden.length > 0) ({ gaps, slack } = yield* justify(this.justified(run, plans, fit.lines, hidden), phase));
      yield* phase.write();
      this.fillFound(hidden);
      if (this.opener !== null) this.reveal(true, hidden);
    } finally {
      for (const release of held.reverse()) release();
    }

    const state = this.makeState(hidden, fit.lines, gaps, pins, slack);
    this.current = state;
    this.unlockHeight();
    if (hold && state.truncated && this.settings.lines > 1 && !this.revealed) {
      yield* phase.read();
      const natural = getComputedStyle(host).height;
      yield* phase.write();
      this.lockHeight(natural);
    }
    host.toggleAttribute('data-truncated', state.truncated);
    if (this.settings.title && state.truncated !== this.titled) {
      if (state.truncated) host.title = this.text;
      else host.removeAttribute('title');
      this.titled = state.truncated;
    }
    if (this.focused) this.markFocus();

    if (tracking) {
      yield* phase.read();
      this.recordPainted(run);
    }
    return { reason, previous, state, reset, tracking, glyphsBefore, marksBefore };
  }

  /** Tell listeners about a finished pass. */
  private finish({ reason, previous, state, reset, tracking, glyphsBefore, marksBefore }: Painted) {
    const change = tracking ? changeOf(reason, previous, state, reset, glyphsBefore, marksBefore) : null;
    if (change) for (const fn of this.listeners) fn(change);
    for (const fn of this.renderListeners) fn(state);
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
        glyphs.set(i, { box: local(box), ink: local(glyphInk(run, this.g[i], box)) });
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
      expanded: this.revealed,
      hidden: hidden.map(part),
      kept: hidden.length > 0 ? pins.map(part) : [],
      lines,
      gaps,
      slack,
    };
  }
}

/** Truncate `element`'s text. Returns a live instance; call `destroy()` to undo. */
export function elide(element: HTMLElement, options?: ElideOptions): Elide {
  return new Elide(element, options);
}
