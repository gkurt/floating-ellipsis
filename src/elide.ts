import {
  type Cutting,
  type Edges,
  type Layout,
  type Range,
  type Tried,
  asArray,
  bothEdges,
  contextOf,
  estimateKept,
  hiddenRanges,
  keepContexts,
  maxKept,
  wholeEdges,
  isPlace,
  placedLayout,
  placesOf,
  graphemeClasses,
  keepClasses,
  keepRanges,
  keptWidth,
  layoutFor,
  sameRanges,
  steeredSteps,
  shownLength,
  giveWay,
  toGraphemeRanges,
  union,
  wordAround,
  wordsOf,
} from './cut.ts';
import { byId, forgetFound, hookDocument, instances } from './document.ts';
import { graphemes, isCJK, isWhitespace } from './graphemes.ts';
import { type Marking, besideEllipsis, fillPiece, shortCopy, shortOf } from './highlight.ts';
import { openUp } from './inside.ts';
import { type Join, createJoin, drawMarks, fillWords, forgetWords, reconcile, setFindable, showHidden, space, spellCells } from './join.ts';
import { type Justified, justify } from './justify.ts';
import { type LineBox, contentEdges, contentHeight, holdStyle, lineBoxes, lineSpan } from './lines.ts';
import { Phase, type Pass, lockstep } from './lockstep.ts';
import {
  type EllipsisStyle,
  type MarkLayout,
  groupMetrics,
  layoutMarks,
  markCount,
  markStyleFor,
  onCells,
  styleMarks,
  toPx,
} from './marks.ts';
import {
  type Chain,
  type Shortened,
  UNIT_COPY,
  adopt,
  extentOf,
  graphemesWith,
  markCopies,
  originals,
  readMarkup,
  speak,
} from './markup.ts';
import { type GapPlan, type GlyphMetrics, type Typeset, glyphIn, planGap, resolveGap, typesetOf } from './metrics.ts';
import {
  type AutoSizeSlot,
  type ChangeReason,
  type ElideOptions,
  type ElideState,
  type GapInfo,
  type Settings,
  type SuffixSlot,
  DEFAULTS,
  defined,
  repeatRatio,
  stateOf,
  wraps,
} from './options.ts';
import { Predictor, advanceSums, kerningOf, marginFor } from './predict.ts';
import { type Form, type ShortPart, formsOf, shortAt, shortRanges, stepsOf, totals } from './shorten.ts';

/** What a pass knows about the element and how its text is set. */
export interface Run extends Typeset {
  /** The element's border box. */
  box: DOMRect;
  /** Content box edges and width. */
  left: number;
  right: number;
  width: number;
  marks: MarkLayout | null;
  /**
   * Running total of advances: `sums[i]` is the width of graphemes [0, i),
   * a part showing in a short form as wide as that, on its first grapheme.
   */
  sums: Float64Array;
  /** `sums` with every part in its long form. */
  long: Float64Array;
  /** The width of the suffix, as it shows when the pass starts. */
  suffix: number;
  /** The element's word-spacing and font size, in px. */
  wordSpacing: number;
  fontSize: number;
  /** Lines break with the whole paragraph in view (`text-wrap: balance` or `pretty`), not one after another. */
  rebreaks: boolean;
  /** The bottom border and padding, and the line height in px (null for `normal`): where lines fit with `lines: 'fit'`. */
  inset: number;
  lineHeight: number | null;
}

/** How the rendered text lies: whether it fits, on how many lines, and where it ends. */
interface Fit {
  ok: boolean;
  lines: number;
  /** How many lines may show: `lines`, or as many as fit the element's height. */
  max: number;
  end: number;
  /**
   * Roughly how much more text would fit, in px: the room left on the
   * lines, or (negative) what overflows them.
   */
  room: number;
}

/** A finished pass, for its listeners. */
interface Painted {
  reason: ChangeReason;
  previous: ElideState | null;
  state: ElideState;
  reset: boolean;
  tracker: Tracker | null;
}

/**
 * What `onChange` (`floating-ellipsis/changes`) hooks into an instance's
 * passes, to tell what each changed and where things were before.
 */
export interface Tracker {
  /**
   * A pass is about to be painted: remember where things are, in a read
   * phase shared with other passes. `since`: the last painting is what this
   * one changed (not the first, or new text), and the host's box was `box`
   * when the pass started.
   */
  painted(run: Run, since: DOMRect | null): void;
  /** The pass is done and painted. */
  done(reason: ChangeReason, previous: ElideState | null, state: ElideState, reset: boolean): void;
}

/** A piece of the rendered text: see `layoutOf`. */
export interface Piece {
  el: HTMLSpanElement;
  range: Range;
  shown: Range;
}

/**
 * What the package's add-ons (geometry, glyph mode, `onChange`) reach inside
 * an instance for. Not part of the public API.
 */
export interface Inside {
  /** Run a pending pass now. */
  sync(): void;
  readonly settings: Readonly<Settings>;
  readonly current: ElideState | null;
  readonly run: Run | null;
  readonly joins: readonly Join[];
  readonly line: HTMLSpanElement;
  readonly offsets: readonly number[];
  /** Glyph mode's elements, one per grapheme; empty otherwise. */
  readonly glyphs: readonly HTMLSpanElement[];
  /** Where the graphemes showing now are rendered. */
  pieces(): Piece[];
  /** Hook `tracker` into every pass, or stop (null). */
  track(tracker: Tracker | null): void;
}

/** What expanded an instance: find in page, focus on a link it hid, or `expand()`. */
type Opener = 'find' | 'focus' | 'api';

const SR_ONLY =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;' +
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;user-select:none';

/** Whether wrapping can be turned off without touching how white space collapses. */
const WRAP_MODE = typeof CSS !== 'undefined' && CSS.supports('text-wrap-mode', 'nowrap');

let nextId = 1;

/** `n`, or 0 when it isn't a number (`normal`, say). */
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/** Passes waiting to run together (see `Elide.schedule`), and whether a flush is on its way. */
const queued = new Map<Elide, ChangeReason>();
let flushing = false;

/**
 * Instances whose hidden text has yet to be put where find in page finds it
 * (see `fillFound`). Nobody searches in the middle of a resize: that waits
 * until passes stop for a moment, and then each is filled once.
 */
const unfound = new Set<Elide>();
let finding: ReturnType<typeof setTimeout> | null = null;
const FIND_DELAY = 200;

/** How far off the edge a line justified as judged may end, in px, before it is justified again. */
const SLIP = 0.1;

/**
 * One ResizeObserver for every instance, so a resize re-truncates them all in
 * one batch, and one IntersectionObserver telling which are near the screen.
 */
let sharedObserver: ResizeObserver | null = null;
let nearObserver: IntersectionObserver | null = null;
const observed = new Map<Element, Elide>();

/** One more for the max-height of every element fitted to its height (see `watchRoom`). */
let roomObserver: ResizeObserver | null = null;
const rooms = new Map<Element, Elide>();

/** Out of sight and out of the flow, taking the element's max-height for a box too tall for any to be its height. */
const ROOM = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;max-height:inherit';
const ROOM_INSIDE = 'display:block;height:1000000px;max-height:inherit';

export class Elide {
  readonly element: HTMLElement;

  #settings: Settings;
  readonly #id = String(nextId++);
  /** The `text` option as given (undefined: the element's own content). */
  #source: string | Node | undefined;
  #text = '';
  #g: string[] = [];
  #offsets: number[] = [0];
  #glyphEls: HTMLSpanElement[] = [];
  #pins: Range[] = [];
  /** Kept parts with words of context to show around them (see `contextOf`). */
  #contexts: [Range, number][] = [];
  /** Where cuts may start and end so as not to split a whole; null for anywhere. */
  #wholes: Edges | null = null;
  /** The letter-spacing `tighten` took off the full text showing, in px (0: none). */
  #tightened = 0;
  /** Parts that may show shorter (see `shorten`): `data-elide-short` markup's, then the option's. */
  #forms: Form[] = [];
  /** The text's `data-elide-short` elements (see `readMarkup`). */
  #marked: Shortened[] = [];
  /** The parts showing in a short form now, in order. */
  #short: ShortPart[] = [];
  /** In glyph mode, the element each part showing short is, so filling a piece again keeps it. */
  readonly #shortEls = new Map<string, Element>();
  /** The classes `keep` gives each grapheme, or null; empty when none has any. */
  #classes: (string | null)[] = [];
  /** The elements around each grapheme, or null; empty for plain text. */
  #chains: (Chain | null)[] = [];
  /** The unit (an image, an icon) each grapheme is, or null; empty when there are none. */
  #units: (Element | null)[] = [];
  /** How wide each unit's copy was last laid out in the line, by grapheme. */
  readonly #unitWidths = new Map<number, number>();
  /** No grapheme has a class or elements around it. */
  #plain = true;
  /** No whitespace that layout collapses: runs of it, or at either end. */
  #even = true;
  /** The glyph metrics `Predictor` misjudged this text with, if it did (see `pass`). */
  #misjudged: Typeset['glyphs'] | null = null;
  /** The screen-reader copy was made while the element was out of the document, so as plain text (see `speak`). */
  #unsaid = false;
  /** Holds `suffix`, after the line, while there is one. */
  #suffix: SuffixSlot | null = null;
  /** The copy of the full text that sizes the element, while `autoSize` is on. */
  #sizer: AutoSizeSlot | null = null;
  /** What wants the hidden parts shown in place, if anything; and whether they are. */
  #opener: Opener | null = null;
  /** What to keep in sight for now, as if kept: what find in page found, or a focused link the cut hid. */
  #sought: { range: Range; by: 'find' | 'focus' } | null = null;
  #revealed = false;
  /** The element (in the original) of the focused link in the screen-reader copy. */
  #focused: Element | null = null;
  #layout: Layout = layoutFor(0, ['end']);
  /** Some position is a place along the line (see `Place`). */
  #placing = false;
  readonly #original: Node[];
  readonly #srEl: HTMLSpanElement;
  readonly #lineEl: HTMLSpanElement;
  readonly #runs: HTMLSpanElement[] = [];
  readonly #joins: Join[] = [];
  #tracker: Tracker | null = null;
  readonly #renderListeners = new Set<(state: ElideState) => void>();
  #lastWidth = -1;
  /** The element's border-box height as last measured with `lines: 'fit'`: a resize to another is the room changing. */
  #lastHeight = -1;
  /** The box as tall as the element's max-height, while one is watched (see `watchRoom`), and its height. */
  #room: HTMLElement | null = null;
  #roomHeight = -1;
  /** Far from the screen, as far as the IntersectionObserver knows (null until it has said). */
  #far: boolean | null = null;
  /** A pass put off while far from the screen (see `putOff`). */
  #owed: ChangeReason | null = null;
  /** Something is being read from the instance, so its passes can't wait. */
  #reading = false;
  /** How far the search's starting estimate was off last time, in graphemes; null before a first search. */
  #bias: number | null = null;
  #current: ElideState | null = null;
  #lastRun: Run | null = null;
  #pendingReset = false;
  /** The full text shows, as just set, so a pass can start from measuring it. */
  #fresh = true;
  #titled = false;
  #destroyed = false;
  #style: EllipsisStyle = '…';
  /** The text is Chinese or Japanese, for `ellipsis: 'auto'` (see `isCJK`). */
  #cjk = false;
  /** Gives the element its own inline height back, while we hold it. */
  #heightLock: (() => void) | null = null;
  /** How many lines the text was on when its height was held. */
  #lockedLines = 0;
  /** Gives the element its own inline overflow back, while a put-off pass has it clipped. */
  #clipped: (() => void) | null = null;
  /** Gives the element its own `text-wrap` back, while truncated text breaks its lines greedily (see `greedy`). */
  #ungreedy: (() => void) | null = null;

  constructor(element: HTMLElement, options: ElideOptions = {}) {
    const { text, ...rest } = options;
    this.element = element;
    this.#settings = { ...DEFAULTS, ...defined(rest) };
    this.#original = Array.from(element.childNodes);

    this.#srEl = document.createElement('span');
    this.#srEl.setAttribute('data-fp-full', '');
    this.#srEl.style.cssText = SR_ONLY;
    // Focus moving within the copy goes out and in again: only leaving it counts.
    this.#srEl.addEventListener('focusin', (e) => this.#focusOn(e.target));
    this.#srEl.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      this.#focusOn(next instanceof Node && this.#srEl.contains(next) ? next : null);
    });
    this.#lineEl = document.createElement('span');
    this.#lineEl.setAttribute('data-fp-text', '');
    this.#lineEl.setAttribute('aria-hidden', 'true');
    // (Not bubbling, but it can be caught on its way down.)
    this.#lineEl.addEventListener('load', (e) => this.#loaded(e.target), true);
    this.#join(0);

    this.#setText(text);
    element.replaceChildren(this.#srEl, this.#lineEl);
    this.#setSuffix();
    this.#setSizer();
    // The full text until the first pass, which is scheduled (see `schedule`).
    // On one line, so that the first pass can wait (see `putOff`).
    this.#showAll();
    if (WRAP_MODE) this.#steadyLines('');
    this.#clip(true);

    instances.add(this);
    // Turns off fallback.css's plain truncation.
    element.setAttribute('data-elide', '');
    byId.set(this.#id, {
      instance: this,
      hidden: () => this.#current?.hidden ?? [],
      short: () => this.#current?.short ?? [],
      found: (part, word) => this.#foundIn(part, word),
      foundShort: (start) => this.#foundShort(start),
      unfound: () => {
        if (this.#opener === 'find') this.collapse();
        if (this.#sought?.by === 'find') this.#seek(null);
      },
    });
    hookDocument();
    this.#schedule('init');
    this.#observe(this.#settings.observe);
    this.#watchRoom();
  }

  /** Current settings. */
  get options(): Readonly<Settings> {
    return this.#settings;
  }

  /** Current result. Before the first layout it describes the untruncated text. */
  get state(): ElideState {
    this.#sync();
    return this.#current ?? this.#makeState([], 0, []);
  }

  get truncated(): boolean {
    this.#sync();
    return this.#current?.truncated ?? false;
  }

  /** The text split into graphemes; state indices refer to this array. */
  get graphemes(): readonly string[] {
    return this.#g;
  }

  /** The first ellipsis element. Stable for the lifetime of the instance. */
  get ellipsisElement(): HTMLSpanElement {
    return this.#joins[0]!.ellipsis;
  }

  /** The ellipsis elements currently showing, in order. */
  get ellipses(): HTMLSpanElement[] {
    this.#sync();
    return this.#joins.slice(0, this.#current?.hidden.length ?? 0).map((j) => j.ellipsis);
  }

  /**
   * Where `render` puts the graphemes with `hidden` cut: visible run r lies
   * between ellipsis r - 1 and ellipsis r. Its first grapheme sits in the join
   * before it and its last in the join after it, so a line break can't part
   * an ellipsis from its neighbours (see `beside`). `shown` is the visible run
   * of each piece.
   */
  #layoutOf(hidden: readonly Range[]): Piece[] {
    const n = this.#g.length;
    const m = hidden.length;
    const out: Piece[] = [];
    const marking = this.#marking;
    const words = () => wordsOf(this.#g);
    const wrapping = wraps(this.#settings.lines);
    for (let r = 0; r <= m; r++) {
      let a = r === 0 ? 0 : hidden[r - 1]![1];
      let b = r === m ? n : hidden[r]![0];
      const shown: Range = [a, b];
      if (r > 0) {
        const take = besideEllipsis(marking, this.#g, words, [a, b], a, wrapping);
        out.push({ el: this.#join(r - 1).after, range: [a, a + take], shown });
        a += take;
      }
      if (r < m) {
        const take = besideEllipsis(marking, this.#g, words, [a, b], b - 1, wrapping);
        out.push({ el: this.#join(r).before, range: [b - take, b], shown });
        b -= take;
      }
      out.push({ el: this.#runEl(r), range: [a, b], shown });
    }
    return out;
  }

  /** The cut showing now. */
  get #cut(): Range[] {
    return (this.#current?.hidden ?? []).map((p): Range => [p.start, p.end]);
  }

  /** The classes `keep` gives grapheme `index` (space-separated), or null. */
  classOf(index: number): string | null {
    return this.#classes[index] ?? null;
  }

  /** The element grapheme `index` stands for when it is a unit (an image, an icon, `data-elide-unit`), or null. */
  unitOf(index: number): Element | null {
    return this.#units[index] ?? null;
  }

  /** Whether what the ellipses hide is showing in their place (see `expand`). */
  get expanded(): boolean {
    this.#sync();
    return this.#revealed;
  }

  /**
   * Show what the ellipses hide in their place: all of the text, on as many
   * lines as it takes, until `collapse()`. The cut stays as it was (`state`),
   * so collapsing is quick. With `find: 'expand'`, find in page does this
   * when it finds hidden text, and so does focus reaching a link the cut hides.
   */
  expand(): void {
    this.#open('api');
  }

  /** Put the ellipses back after `expand()` (or find in page) showed what they hide. */
  collapse(): void {
    if (this.#opener === null || this.#destroyed) return;
    this.#opener = null;
    forgetFound(this);
    this.#schedule('refresh');
  }

  #open(by: Opener) {
    if (this.#destroyed) return;
    if (by !== 'find') forgetFound(this);
    if (this.#opener !== null) {
      // Asked for outright, it stays open, whatever opened it first.
      if (by === 'api') this.#opener = by;
      return;
    }
    this.#opener = by;
    // A pass on its way ends expanded; otherwise the parts are shown now.
    this.#sync();
    if (this.#revealed || !this.#current) return;
    this.#reveal(true);
    this.#current = { ...this.#current, expanded: true, shortened: false, short: [] };
    for (const fn of this.#renderListeners) fn(this.#current);
  }

  /** A link (or anything focusable) in the screen-reader copy took focus, or lost it (null). */
  #focusOn(target: EventTarget | null) {
    const focused = target instanceof Element ? (originals.get(target) ?? null) : null;
    if (focused === this.#focused) return;
    this.#focused = focused;
    const seen = this.#markFocus();
    const expand = this.#settings.find === 'expand';
    if (focused && !seen && expand) this.#open('focus');
    else if (focused && !seen) this.#seek(extentOf(this.#chains, focused), 'focus');
    else if (!focused && this.#opener === 'focus') this.collapse();
    else if (!focused && this.#sought?.by === 'focus') this.#seek(null);
  }

  /**
   * Find in page found text ellipsis `part` hides, starting in `word` when
   * that's known: expand, or keep the word in sight.
   */
  #foundIn(part: number, word: Range | null) {
    if (this.#settings.find === 'expand') return this.#open('find');
    // The browser shows the hidden text it found once this returns: put it
    // back before that's painted, with the word showing in the line instead.
    const hidden = this.#current?.hidden[part];
    const range = word ?? (hidden ? wordAround(wordsOf(this.#g), hidden.start) : null);
    for (const join of this.#joins) forgetWords(join);
    requestAnimationFrame(() => this.#seek(range, 'find'));
  }

  /** Find in page found the long form of the part showing short from `start`: expand, or show it long for now. */
  #foundShort(start: number) {
    const form = this.#forms.find((f) => f.start === start);
    if (!form) return;
    if (this.#settings.find === 'expand') return this.#open('find');
    requestAnimationFrame(() => this.#seek([form.start, form.end], 'find'));
  }

  /** Keep `range` in sight for now (see `sought`), or stop (null). */
  #seek(range: Range | null, by: 'find' | 'focus' = 'find') {
    if (this.#destroyed) return;
    this.#sought = range ? { range, by } : null;
    const match = this.#marking.match;
    this.#settings.glyphs?.mark(this.#glyphEls, 'data-fp-match', match ? [match] : []);
    this.#bias = null;
    this.#schedule('refresh');
  }

  /**
   * Mark the copies in the line of the focused element `data-fp-focus`, so
   * CSS can draw a focus ring there. Returns whether one of them shows.
   */
  #markFocus(): boolean {
    return markCopies(this.#lineEl, this.#focused, 'data-fp-focus').some((el) => this.#revealed || !el.closest('[data-fp-found]'));
  }

  /**
   * Called after every layout pass, including resizes that leave the visible
   * text as it was (the gaps still change). Returns an unsubscribe function.
   */
  onRender(fn: (state: ElideState) => void): () => void {
    this.#renderListeners.add(fn);
    return () => this.#renderListeners.delete(fn);
  }

  /** Change text and/or options and re-truncate. */
  update(options: ElideOptions): void {
    const { text, ...rest } = options;
    const before = this.#settings;
    this.#settings = { ...before, ...defined(rest) };
    const s = this.#settings;
    const restyled =
      markStyleFor(s, this.#cjk) !== this.#style &&
      (s.ellipsis !== before.ellipsis || s.justify !== before.justify || s.repeat !== before.repeat);
    if (restyled || wraps(s.lines) !== wraps(before.lines)) this.#restyle();
    if (s.observe !== before.observe) this.#observe(s.observe);
    if (s.lines !== before.lines) this.#bias = null;
    this.#watchRoom();
    if (s.suffix?.content !== before.suffix?.content) this.#setSuffix();
    if ((text !== undefined && text !== this.#source) || s.glyphs !== before.glyphs) {
      this.#sought = null;
      this.#setText(text ?? this.#source);
      this.#showAll();
      this.#fresh = true;
      this.#pendingReset = true;
    } else {
      if (s.keep !== before.keep || s.whole !== before.whole || s.shorten !== before.shorten) this.#setPins();
      if (s.position !== before.position) this.#setLayout();
    }
    this.#setSizer();
    if (!s.title && this.#titled) {
      this.element.removeAttribute('title');
      this.#titled = false;
    }
    this.#schedule('update');
  }

  /** Re-measure and re-truncate, e.g. after a style change the observer can't see. */
  refresh(reason: ChangeReason = 'refresh'): void {
    this.#schedule(reason);
  }

  /** Stop observing and restore the element's original content. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#observe(false);
    this.#watchRoom();
    queued.delete(this);
    unfound.delete(this);
    instances.delete(this);
    byId.delete(this.#id);
    this.#tracker = null;
    this.#renderListeners.clear();
    forgetFound(this);
    this.#unlockHeight();
    this.#clip(false);
    this.#greedy(false);
    this.element.removeAttribute('data-truncated');
    this.element.removeAttribute('data-shortened');
    this.element.removeAttribute('data-elide');
    this.element.removeAttribute('data-fp-expanded');
    if (this.#titled) this.element.removeAttribute('title');
    this.#sizer = null;
    this.element.replaceChildren(...this.#original);
    this.#suffix?.giveBack(true);
  }

  // -------------------------------------------------------------------------
  // Setup

  #observe(on: boolean) {
    const host = this.element;
    if (!on) {
      if (observed.get(host) !== this) return;
      observed.delete(host);
      sharedObserver?.unobserve(host);
      nearObserver?.unobserve(host);
      this.#far = null;
      if (this.#owed) this.#schedule(this.#owed);
      return;
    }
    if (observed.get(host) === this || typeof ResizeObserver === 'undefined') return;
    if (!sharedObserver) {
      sharedObserver = new ResizeObserver((entries) => Elide.#resized(entries));
      // Not bubbling, but it can be caught on its way down.
      document.addEventListener('contentvisibilityautostatechange', (e) => Elide.#unskipped(e), true);
    }
    observed.set(host, this);
    sharedObserver.observe(host);
    if (typeof IntersectionObserver === 'undefined') return;
    nearObserver ??= new IntersectionObserver((entries) => Elide.#neared(entries), { rootMargin: '100%' });
    nearObserver.observe(host);
  }

  /**
   * With `lines: 'fit'`, watch the element's max-height. An element whose
   * height comes from its text, capped by max-height, keeps its size when
   * the cap rises past the lines it shows, so the ResizeObserver can't tell
   * there is room for more. A box out of sight takes the same cap over a
   * height too tall for any, so its height is the cap, and it resizes as the
   * cap does. (A cap in percent resolves against the box's own container,
   * so it isn't seen.)
   */
  #watchRoom() {
    const { lines, observe } = this.#settings;
    const on = !this.#destroyed && observe && lines === 'fit' && typeof ResizeObserver !== 'undefined';
    if (on === (this.#room !== null)) return;
    if (this.#room) {
      roomObserver?.unobserve(this.#room);
      rooms.delete(this.#room);
      this.#room.parentElement?.remove();
      this.#room = null;
      return;
    }
    const outer = document.createElement('span');
    outer.setAttribute('data-fp-room', '');
    outer.setAttribute('aria-hidden', 'true');
    outer.style.cssText = ROOM;
    const room = document.createElement('span');
    room.style.cssText = ROOM_INSIDE;
    outer.append(room);
    this.element.append(outer);
    this.#room = room;
    this.#roomHeight = -1;
    rooms.set(room, this);
    roomObserver ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const instance = rooms.get(entry.target);
        if (!instance) continue;
        const height = entry.contentRect.height;
        // The first report is how it starts out.
        const moved = instance.#roomHeight >= 0 && Math.abs(height - instance.#roomHeight) > 0.01;
        instance.#roomHeight = height;
        if (moved) instance.#schedule('resize');
      }
    });
    roomObserver.observe(room);
  }

  /** Read the text, and its elements, from `source`: a string, a node, or (undefined) the element's own content. */
  #setText(source: string | Node | undefined) {
    this.#source = source;
    const suffix = this.#settings.suffix?.content;
    const { text, chains, units, short } =
      typeof source === 'string'
        ? { text: source, chains: null, units: [], short: [] }
        : readMarkup(source === undefined ? this.#original : [source], typeof suffix === 'object' ? suffix : null);
    this.#text = text;
    this.#marked = short;
    this.#short = [];
    this.#shortEls.clear();
    this.#even = !/^\s|\s$|\s\s|[\t\n\r\f]/.test(text);
    this.#misjudged = null;
    ({ graphemes: this.#g, units: this.#units } = graphemesWith(text, units));
    const cjk = isCJK(this.#g, this.element.closest('[lang]')?.getAttribute('lang') ?? '');
    if (cjk !== this.#cjk) {
      this.#cjk = cjk;
      if (this.#settings.ellipsis === 'auto') this.#restyle();
    }
    this.#unitWidths.clear();
    this.#offsets = [0];
    for (const s of this.#g) this.#offsets.push(this.#offsets[this.#offsets.length - 1]! + s.length);
    this.#chains = chains ? this.#g.map((_, i) => chains[this.#offsets[i]!] ?? null) : [];
    this.#glyphEls = this.#settings.glyphs?.create(this.#g, this.#units) ?? [];
    this.#unsaid = !speak(this.#srEl, this.element, this.#g, this.#chains, this.#units) && !this.element.isConnected;
    this.#setPins();
    this.#setLayout();
  }

  /** Put `suffix` after the line (see `Suffix`). */
  #setSuffix() {
    const suffix = this.#settings.suffix;
    if (suffix && suffix.content !== '') {
      (this.#suffix ??= suffix.place(this.element, () => {
        this.#setSizer();
        this.refresh();
      })).fill(suffix.content);
      return;
    }
    this.#suffix?.giveBack(false);
    this.#suffix?.el.remove();
    this.#suffix = null;
  }

  /** Copy the full text, and a suffix that always shows, for `autoSize` to size the element by; or take the copy out. */
  #setSizer() {
    const autoSize = this.#settings.autoSize;
    if (!autoSize) {
      this.#sizer?.remove();
      this.#sizer = null;
      return;
    }
    this.#sizer ??= autoSize.place(this.element);
    const n = this.#g.length;
    fillPiece(this.#sizer.text, this.#g, { ...this.#longMarking, match: null }, [0, n], [0, n]);
    this.#sizer.suffix(this.#suffix && this.#settings.suffix?.show === 'always' ? this.#suffix.el : null);
  }

  /** Find what `keep` and `whole` match. */
  #setPins() {
    const keep = asArray(this.#settings.keep);
    // Each on its own: wholes that touch are still two.
    const ranges = (r: Range) => toGraphemeRanges([r], this.#offsets);
    this.#pins = toGraphemeRanges(keepRanges(this.#text, keep), this.#offsets);
    this.#contexts = keepContexts(this.#text, keep).flatMap(([r, words]) => ranges(r).map((g): [Range, number] => [g, words]));
    this.#wholes = wholeEdges(this.#g.length, keepRanges(this.#text, asArray(this.#settings.whole)).flatMap(ranges));
    const marked = this.#marked.map(({ start, end, to }) => ({ start, end, to }));
    this.#forms = formsOf(this.#text, this.#offsets, [...marked, ...asArray(this.#settings.shorten)]);
    const classes = keepClasses(this.#text, keep);
    this.#classes = classes.length > 0 ? graphemeClasses(classes, this.#offsets) : [];
    this.#plain = this.#chains.length === 0 && this.#units.length === 0 && this.#classes.every((c) => c === null);
    this.#settings.glyphs?.mark(this.#glyphEls, 'data-fp-kept', this.#pins);
    this.#glyphEls.forEach((el, i) => (el.className = this.#classes[i] ?? ''));
    this.#bias = null;
  }

  #setLayout() {
    const positions = asArray(this.#settings.position);
    this.#layout = layoutFor(this.#g.length, positions);
    this.#placing = positions.some(isPlace);
    this.#bias = null;
  }

  /**
   * The islands for positions with places along the line (see
   * `placedLayout`): what fits before each place, as its glyph widths (with
   * kerning) say, with the ellipsis in the middle of it and the gap it wants
   * either side. Reads nothing.
   */
  #placed(run: Run): Layout {
    const g = this.#g;
    const { group, target } = this.#spacing(run);
    const kerns = kerningOf(g, run);
    const { sums, left, right } = run;
    const size = typeof target === 'number' ? group.left + group.right + 2 * target : group.advance;
    const places = placesOf(asArray(this.#settings.position), left, right, right - run.suffix, size, run.marks!.fontSize);
    // The ink of graphemes [s, e), but white space a cut would trim.
    const ink = (s: number, e: number) => {
      if (this.#settings.trim) {
        while (s < e && isWhitespace(g[s])) s++;
        while (e > s && isWhitespace(g[e - 1])) e--;
      }
      if (e <= s) return 0;
      const last = this.#neighbour(run, e - 1);
      return (
        sums[e]! - sums[s]! + kerns[e]! - kerns[s + 1]! + (this.#neighbour(run, s)?.left ?? 0) + (last ? last.right - last.advance : 0)
      );
    };
    return placedLayout(
      g.length,
      places,
      left,
      right,
      (i, s, e) => ink(s, e) <= places[i]! - size / 2 - (i === 0 ? left : places[i - 1]! + size / 2),
    );
  }

  /** The join (ellipsis with its neighbouring glyphs) at `index`, created on demand. */
  #join(index: number): Join {
    let join = this.#joins[index];
    if (!join) {
      join = createJoin(this.#id, index, this.#settings.find !== false);
      this.#fillMarks(join);
      this.#joins[index] = join;
    }
    return join;
  }

  /** The marks being drawn: `options.ellipsis`, unless `justify: 'dots'` or `repeat` needs it split into dots. */
  get markStyle(): EllipsisStyle {
    return this.#style;
  }

  #fillMarks(join: Join) {
    this.#style = markStyleFor(this.#settings, this.#cjk);
    // Only text that can wrap needs gluing: Firefox letter-spaces the joiners.
    drawMarks(join, this.#style, wraps(this.#settings.lines));
  }

  /** Draw every ellipsis' marks afresh. */
  #restyle() {
    for (const join of this.#joins) this.#fillMarks(join);
    // The old measurements describe marks that are gone.
    if (this.#lastRun) this.#lastRun.marks = null;
  }

  #runEl(index: number): HTMLSpanElement {
    let el = this.#runs[index];
    if (!el) {
      el = document.createElement('span');
      el.setAttribute('data-fp-run', '');
      this.#runs[index] = el;
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
  #steadyLines(whiteSpace: string) {
    const single = !wraps(this.#settings.lines);
    if (WRAP_MODE) this.#lineEl.style.setProperty('text-wrap-mode', single ? 'nowrap' : '');
    else this.#lineEl.style.whiteSpace = single && whiteSpace === 'normal' ? 'nowrap' : '';
  }

  /** Hold the element's height at `height`, its computed height. */
  #lockHeight(height: string) {
    if (height.endsWith('px')) this.#heightLock = holdStyle(this.element, 'height', height);
  }

  #unlockHeight() {
    this.#heightLock?.();
    this.#heightLock = null;
  }

  /**
   * Clip the element while a pass is put off: what it shows meanwhile (the
   * full text, or a cut for another width) can overflow, and when it comes
   * into view faster than the observers can tell, it is painted once like that.
   */
  #clip(on: boolean) {
    if (on === (this.#clipped !== null)) return;
    this.#clipped?.();
    this.#clipped = on ? holdStyle(this.element, 'overflow', 'clip') : null;
  }

  /**
   * Break the lines of truncated text one after another (`on`), whatever
   * `text-wrap` says, or as it says again. `balance` and `pretty` break
   * them with the whole paragraph in view, evening them out: truncated text
   * fills every line to the edge, so there's nothing to even out, and they
   * would only move the breaks once the cut is fitted, leaving the ellipsis
   * line short of the edge (or the text a line too long). Text that fits
   * wraps as the page says. `text-wrap-style` applies to the element, a
   * block, so it's set there.
   */
  #greedy(on: boolean) {
    if (on === (this.#ungreedy !== null)) return;
    this.#ungreedy?.();
    this.#ungreedy = on ? holdStyle(this.element, WRAP_MODE ? 'text-wrap-style' : 'text-wrap', WRAP_MODE ? 'auto' : 'wrap') : null;
  }

  /** What a pass needs to know about the element. Reads layout. */
  #prepare(cs: CSSStyleDeclaration, box: DOMRect): Run {
    const { left, right } = contentEdges(this.element, cs, box);
    const typeset = typesetOf(cs);
    const sums = this.#sumsOf(typeset);
    return {
      ...typeset,
      box,
      left,
      right,
      // As a ResizeObserver reports it.
      width: right - left,
      marks: null,
      sums,
      long: sums,
      suffix: this.#suffix?.measure() ?? 0,
      wordSpacing: finite(parseFloat(cs.wordSpacing)),
      fontSize: parseFloat(cs.fontSize),
      // While truncated, the style read is `greedy`'s own, not the page's.
      rebreaks:
        this.#ungreedy !== null || /balance|pretty/.test(cs.getPropertyValue('text-wrap-style') || cs.getPropertyValue('text-wrap')),
      inset: parseFloat(cs.borderBottomWidth) + parseFloat(cs.paddingBottom),
      lineHeight: cs.lineHeight.endsWith('px') ? parseFloat(cs.lineHeight) : null,
    };
  }

  /**
   * The graphemes' running total of advances (see `advanceSums`), each unit
   * as wide as its copy was last laid out in the line: canvas can't measure
   * an image. Reads layout.
   */
  #sumsOf(typeset: Typeset): Float64Array {
    const sums = advanceSums(this.#g, typeset);
    if (this.#units.length === 0) return sums;
    for (const el of this.#lineEl.querySelectorAll(`[${UNIT_COPY}]`))
      if (!el.closest('[data-fp-found]')) this.#unitWidths.set(Number(el.getAttribute(UNIT_COPY)), el.getBoundingClientRect().width);
    const out = new Float64Array(sums.length);
    for (let i = 0; i < this.#g.length; i++) {
      const own = sums[i + 1]! - sums[i]!;
      out[i + 1] = out[i]! + (this.#units[i] ? (this.#unitWidths.get(i) ?? own) : own);
    }
    return out;
  }

  /** An image in the line loaded: if that changed its width, the text fits again. */
  #loaded(target: EventTarget | null) {
    const el = target instanceof Element ? target.closest(`[${UNIT_COPY}]`) : null;
    if (!el || el.closest('[data-fp-found]')) return;
    const width = this.#unitWidths.get(Number(el.getAttribute(UNIT_COPY)));
    if (width === undefined || Math.abs(el.getBoundingClientRect().width - width) > 0.01) this.refresh();
  }

  /**
   * Mark measurements, read from the first ellipsis' computed style. A line
   * `justify: 'spread'` left letter-spaced letter-spaces the ellipsis with
   * it: the marks are measured as they are set without that.
   */
  #markLayout(run: Run): MarkLayout {
    if (run.marks) return run.marks;
    const cs = getComputedStyle(this.#joins[0]!.ellipsis);
    const spread = this.#lineEl.style.letterSpacing;
    const inherited = spread !== '' && Math.abs(parseFloat(cs.letterSpacing) - parseFloat(spread)) < 0.01;
    run.marks = layoutMarks(this.#style, cs, markCount(this.#style), inherited ? run.letterSpacing : undefined);
    return run.marks;
  }

  /**
   * The cuts that save room. Hiding text no wider than the ellipsis that
   * stands in for it (its marks and the gaps either side, as `render` will
   * plan them) only adds an ellipsis. (The first probe of a pass, before an
   * ellipsis has been laid out, can't tell; the search corrects for that.)
   */
  #worthCutting(run: Run, hidden: Range[]): Range[] {
    if (hidden.length === 0 || (!run.marks && !this.#joins[0]?.ellipsis.isConnected)) return hidden;
    const { group, target } = this.#spacing(run);
    return hidden.filter(([s, e]) => {
      const width = run.sums[e]! - run.sums[s]!;
      const plan = planGap(this.#neighbour(run, s - 1), group, this.#neighbour(run, e), target);
      return width > plan.marginLeft + group.advance + plan.marginRight;
    });
  }

  /** The ellipsis' marks as one glyph, and the gap wanted on each side of it. */
  #spacing(run: Run) {
    const layout = this.#markLayout(run);
    // An ellipsis on cells has its room inside it (see `MarkStyle.cells`).
    const target = layout.cells > 0 ? 'none' : resolveGap(this.#settings.gap, layout.fontSize, () => layout.rhythm);
    return { group: groupMetrics(layout, layout.inner), target };
  }

  /**
   * The glyph at `i` as an ellipsis' neighbour: null for none, or whitespace
   * (it has no ink). A unit is inked edge to edge; a part showing short is
   * its short form, as one glyph.
   */
  #neighbour(run: Run, i: number): GlyphMetrics | null {
    const part = this.#short.length > 0 ? shortOf(this.#short, i) : null;
    if (part) {
      if (part.form.trim() === '') return null;
      return { ...glyphIn(run, part.form), advance: run.sums[part.start + 1]! - run.sums[part.start]! };
    }
    const g = this.#g[i];
    if (g === undefined || isWhitespace(g)) return null;
    if (!this.#units[i]) return glyphIn(run, g);
    const width = run.sums[i + 1]! - run.sums[i]!;
    return { advance: width, left: 0, right: width, ascent: 0, descent: 0 };
  }

  /**
   * Whether the highlights and elements in the line set text as the element
   * does (the same font, spacing and case, and nothing beside them taking
   * room), so the glyph widths hold there too. Every kind of them has to be
   * showing to tell. Reads style.
   */
  #uniform(run: Run): boolean {
    const kinds = new Set<string | Element>();
    for (const cls of this.#classes) if (cls !== null) kinds.add(cls);
    for (const chain of this.#chains) for (const el of chain ?? []) kinds.add(el);
    const flat = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'marginLeft', 'marginRight'] as const;
    for (const el of this.#lineEl.querySelectorAll('[data-fp-run] *, [data-fp-before] *, [data-fp-after] *')) {
      const kind = originals.get(el) ?? (el.hasAttribute('data-fp-kept') ? el.className : 'match');
      if (!kinds.delete(kind) && kind !== 'match') continue;
      const cs = getComputedStyle(el);
      if (cs.display !== 'inline' || typesetOf(cs).glyphs !== run.glyphs || flat.some((p) => parseFloat(cs[p]) !== 0)) return false;
    }
    return kinds.size === 0;
  }

  /** The line and the suffix after it: what has to fit. */
  #lineParts(): HTMLElement[] {
    return this.#suffix ? [this.#lineEl, this.#suffix.el] : [this.#lineEl];
  }

  /**
   * How many of `boxes` fit the element's height as laid out now, at least
   * one: a line fits when its line box (centred on its glyphs, as half the
   * leading either side puts it) ends above the content box's bottom.
   */
  #fitting(run: Run, boxes: readonly LineBox[]): number {
    const box = this.element.getBoundingClientRect();
    const bottom = box.bottom - run.inset;
    this.#lastHeight = box.height;
    let fits = 0;
    for (const l of boxes) {
      const half = (run.lineHeight ?? l.bottom - l.top) / 2;
      if ((l.top + l.bottom) / 2 + half > bottom + 0.5) break;
      fits++;
    }
    return Math.max(1, fits);
  }

  /** Does the rendered text fit? Reads layout. */
  #measure(run: Run): Fit {
    const boxes = lineBoxes(...this.#lineParts());
    const { lines } = this.#settings;
    const max = lines === 'fit' ? this.#fitting(run, boxes) : lines;
    const width = run.right - run.left;
    const inside = boxes.every((l) => l.right <= run.right + 0.05 && l.left >= run.left - 0.05);
    const end = boxes.reduce((end, l) => Math.max(end, l.right), -Infinity);
    const ok = inside && boxes.length <= max;
    const used = (l: LineBox) => l.right - l.left;
    // The room on the last line and on the lines not yet used; or what spills
    // past the last line, less the room left on it (what spilled wrapped
    // whole), or past the edge.
    const spill = boxes.slice(max).reduce((sum, l) => sum + used(l), 0) - (boxes.length > max ? width - used(boxes[max - 1]!) : 0);
    const room = ok
      ? (max - boxes.length) * width + width - (boxes.length > 0 ? used(boxes.at(-1)!) : 0)
      : -Math.max(0.01, spill, ...boxes.map((l) => used(l) - width));
    return { ok, lines: boxes.length, max, end, room };
  }

  /** Index of the line ellipsis `index` is on, or -1. */
  #lineOf(index: number, lines: { top: number; bottom: number }[]): number {
    const r = this.#joins[index]!.ellipsis.getBoundingClientRect();
    const middle = r.top + r.height / 2;
    return lines.findIndex((l) => middle >= l.top && middle <= l.bottom);
  }

  // -------------------------------------------------------------------------
  // Rendering

  /** Show graphemes [from, to) in `el`, touching the DOM as little as possible. */
  /** `shown`: the visible run it's part of, which a highlight may go on into. */
  #fill(el: HTMLElement, from: number, to: number, shown: Range = [0, this.#g.length]) {
    const glyphs = this.#settings.glyphs;
    if (glyphs) glyphs.fill(el, this.#glyphEls, this.#chains, [from, to], this.#short, (part) => this.#shortEl(part));
    else fillPiece(el, this.#g, this.#marking, [from, to], shown);
  }

  get #marking(): Marking {
    const sought = this.#sought;
    return {
      classes: this.#classes,
      chains: this.#chains,
      units: this.#units,
      match: sought?.by === 'find' ? sought.range : null,
      plain: this.#plain,
      text: this.#text,
      offsets: this.#offsets,
      short: this.#short,
      shortEl: (part) => this.#shortEl(part),
    };
  }

  /** The marking with every part in its long form: for what an ellipsis hides, and the copy `autoSize` sizes by. */
  get #longMarking(): Marking {
    return { ...this.#marking, short: [] };
  }

  /** The element `part`, showing short, is in the line (see `shortCopy`); in glyph mode, the same one each time. */
  #shortEl(part: ShortPart): Element {
    const find = this.#settings.find !== false;
    if (!this.#settings.glyphs) return shortCopy(part, this.#id, find, adopt(this.element));
    const key = `${part.start}:${part.end}:${part.form}:${find}`;
    let el = this.#shortEls.get(key);
    if (!el) this.#shortEls.set(key, (el = shortCopy(part, this.#id, find, adopt(this.element))));
    return el;
  }

  /**
   * Mark the element truncated (or not) and shortened (or not) for CSS, and
   * give it the full text as its title when asked to.
   */
  #label(hidden: readonly Range[]) {
    const host = this.element;
    const truncated = hidden.length > 0;
    const shortened = this.#short.some((p) => !hidden.some(([s, e]) => s <= p.start && p.end <= e));
    host.toggleAttribute('data-truncated', truncated);
    host.toggleAttribute('data-shortened', shortened);
    const titled = truncated || shortened;
    if (!this.#settings.title || titled === this.#titled) return;
    if (titled) host.title = this.#text.replaceAll('\uFFFC', '');
    else host.removeAttribute('title');
    this.#titled = titled;
  }

  /** Show the suffix as the text is (or isn't) truncated, `hidden` cut. */
  #suffixFor(hidden: readonly Range[]) {
    this.#suffix?.show(hidden.length > 0 || this.#settings.suffix?.show !== 'truncated', hidden, this.#g);
  }

  /**
   * Put the text each ellipsis hides in it, for find in page to find: word by
   * word to keep a match in sight (see `fillWords`), or as it would show
   * expanded (see `reveal`).
   */
  #fillFound(hidden: readonly Range[]) {
    const { find } = this.#settings;
    this.#joins.forEach((join, j) => {
      const part = hidden[j] ?? [0, 0];
      setFindable(join, find !== false);
      if (find === 'keep') fillWords(join, this.#g, wordsOf(this.#g), part);
      else fillPiece(join.found, this.#g, this.#longMarking, part, [0, this.#g.length]);
    });
  }

  /** Fill what the ellipses hide, if a pass left that for later (see `unfound`). */
  #catchUp() {
    if (unfound.delete(this)) this.#fillFound(this.#cut);
  }

  /**
   * Show what the first `count` ellipses hide in their place, the text
   * wrapping onto as many lines as it takes (`on`), or put the ellipses back.
   */
  #reveal(on: boolean, hidden: readonly Range[] = this.#cut) {
    if (on) this.#catchUp();
    this.#revealed = on;
    // All of the text shows: every part in its long form too.
    if (on && this.#short.length > 0) {
      this.#short = [];
      for (const { el, range, shown } of this.#layoutOf(hidden)) this.#fill(el, range[0], range[1], shown);
      this.#label(hidden);
    }
    this.#joins.forEach((join, j) => {
      const part = hidden[j];
      const shown = on && !!part;
      // Found word by word: shown, it's as the text would show.
      if (shown && this.#settings.find === 'keep') {
        forgetWords(join);
        fillPiece(join.found, this.#g, this.#longMarking, part, [0, this.#g.length]);
      }
      showHidden(join, shown, this.#settings.find !== false);
    });
    // A path or a URL has nowhere to wrap: it breaks where it must.
    this.#lineEl.style.overflowWrap = on ? 'break-word' : '';
    if (on) {
      this.#greedy(false);
      this.#tighten(null, 0);
      if (WRAP_MODE) this.#lineEl.style.setProperty('text-wrap-mode', '');
      else this.#lineEl.style.whiteSpace = '';
      this.#unlockHeight();
    }
    this.element.toggleAttribute('data-fp-expanded', on);
  }

  /**
   * The full text. The first ellipsis stays in the DOM, out of sight, so a
   * pass can read its style along with everything else it reads first.
   */
  #showAll() {
    const first = this.#joins[0]!;
    first.el.style.display = 'none';
    first.el.style.position = '';
    reconcile(this.#lineEl, [this.#runEl(0), first.el]);
    this.#fill(this.#runEl(0), 0, this.#g.length);
    this.#fill(first.before, 0, 0);
    this.#fill(first.after, 0, 0);
    this.#suffixFor([]);
    this.#greedy(false);
  }

  /**
   * Full text, keeping a showing ellipsis in the DOM (hiding it would restart
   * its animations) but out of the flow, so the text is measured alone.
   * (Cancelling its width with a margin goes wrong once trying a cut in the
   * same pass has spaced it differently.)
   */
  #renderFull(run: Run) {
    const first = this.#joins[0]!;
    if (first.el.style.display === 'none' || !first.ellipsis.isConnected) {
      this.#render(run, []);
      return;
    }
    const n = this.#g.length;
    this.#tighten(null, 0);
    reconcile(this.#lineEl, [this.#runEl(0), first.el]);
    this.#fill(this.#runEl(0), 0, n);
    this.#fill(first.before, 0, 0);
    this.#fill(first.after, n, n);
    first.el.style.position = 'absolute';
    this.#suffixFor([]);
    this.#greedy(false);
  }

  /**
   * Set the line `by` px tighter per letter, and word spaces twice that (see
   * `tighten`); or as the element sets it, with 0. The ellipses keep their
   * spacing, and so the letters beside them (in their joins), and the gaps
   * planned for them.
   */
  #tighten(run: Run | null, by: number) {
    const tight = run !== null && by > 0;
    this.#tightened = tight ? by : 0;
    this.#lineEl.style.letterSpacing = tight ? `${run.letterSpacing - by}px` : '';
    this.#lineEl.style.wordSpacing = tight ? `${run.wordSpacing - 2 * by}px` : '';
    for (const { el } of this.#joins) {
      el.style.letterSpacing = tight ? `${run.letterSpacing}px` : '';
      el.style.wordSpacing = tight ? `${run.wordSpacing}px` : '';
    }
  }

  /** Put the text into the DOM with `hidden` ranges replaced by ellipses, set `by` px tighter (see `tighten`). */
  #render(run: Run, hidden: readonly Range[], by = 0): GapPlan[] {
    const m = hidden.length;
    this.#tighten(null, 0);
    if (m === 0) {
      this.#showAll();
      return [];
    }
    const want: Node[] = [this.#runEl(0)];
    for (let j = 0; j < m; j++) want.push(this.#join(j).el, this.#runEl(j + 1));
    this.#joins[0]!.el.style.display = '';
    this.#joins[0]!.el.style.position = '';
    reconcile(this.#lineEl, want);
    this.#suffixFor(hidden);
    // (Once on, it hides what the page says: it stays on while truncated.)
    if (run.rebreaks || this.#ungreedy !== null) this.#greedy(true);
    for (const { el, range, shown } of this.#layoutOf(hidden)) this.#fill(el, range[0], range[1], shown);
    if (by > 0) this.#tighten(run, by);

    const layout = this.#markLayout(run);
    if (layout.css !== null) for (let j = 0; j < m; j++) styleMarks(this.#joins[j]!.marks, layout.css);
    if (layout.cells > 0) {
      const generated = adopt(this.element);
      for (let j = 0; j < m; j++) {
        onCells(this.#joins[j]!.marks, layout.metrics[0]?.advance ?? 0);
        if (!generated) spellCells(this.#joins[j]!);
      }
    }
    const plans = this.#plan(run, hidden);
    plans.forEach((plan, j) => space(this.#joins[j]!, plan.marginLeft, plan.marginRight, layout.inner));
    return plans;
  }

  /** The gaps `render` plans around each ellipsis for `hidden`. */
  #plan(run: Run, hidden: readonly Range[]): GapPlan[] {
    if (hidden.length === 0) return [];
    const { group, target } = this.#spacing(run);
    return hidden.map(([s, e]) => planGap(this.#neighbour(run, s - 1), group, this.#neighbour(run, e), target));
  }

  /**
   * The rendered text, for `justify` to fill its lines. With `end`, where a
   * single line is expected to end, that stands in for reading it.
   */
  #justified(run: Run, plans: GapPlan[], lines: number, hidden: readonly Range[], end: number | null = null): Justified {
    const boxes = (): LineBox[] => (end === null ? lineBoxes(...this.#lineParts()) : [{ top: 0, bottom: 0, left: run.left, right: end }]);
    const marks = run.marks!;
    return {
      // An ellipsis on cells keeps its width, so the text after it keeps to them.
      mode: marks.cells > 0 ? false : this.#settings.justify,
      repeat: repeatRatio(this.#settings.repeat),
      // One set like a word may always have a word space.
      maxGap:
        this.#settings.maxGap === null ? null : Math.max(toPx(this.#settings.maxGap, marks.fontSize), marks.word ? (marks.rhythm ?? 0) : 0),
      lines,
      // Truncated, lines break one after another (see `greedy`).
      sure: (!wraps(this.#settings.lines) && WRAP_MODE) || !run.rebreaks || this.#ungreedy !== null,
      right: run.right,
      layout: run.marks!,
      plans,
      characters: Math.max(
        1,
        shownLength(this.#offsets, hidden, markCount(this.#style)) -
          this.#short.reduce(
            (sum, p) => sum + (hidden.some(([s, e]) => s <= p.start && p.end <= e) ? 0 : p.text.length - p.form.length),
            0,
          ),
      ),
      known: end !== null,
      boxes,
      lineOf: (j, boxes) => (end === null ? this.#lineOf(j, boxes) : 0),
      measure: () => lineBoxes(...this.#lineParts()),
      fits: () => this.#measure(run),
      space: (j, left, right, inner) => space(this.#joins[j]!, left, right, inner),
      spread: (ls) => (this.#lineEl.style.letterSpacing = ls !== 0 ? `${run.letterSpacing + ls}px` : ''),
    };
  }

  // -------------------------------------------------------------------------
  // Scheduling

  /**
   * Run a pass in a microtask, together with every other instance's, or as
   * soon as anything is read from this one.
   */
  #schedule(reason: ChangeReason) {
    if (this.#putOff(reason, this.#far === true)) {
      this.#clip(true);
      return;
    }
    if (!queued.has(this)) queued.set(this, reason);
    if (flushing) return;
    flushing = true;
    queueMicrotask(() => Elide.#flush());
  }

  /** Bring a scheduled pass forward: anything read from the instance is up to date. */
  #sync() {
    if (this.#owed && !queued.has(this)) queued.set(this, this.#owed);
    if (queued.has(this)) {
      this.#reading = true;
      try {
        Elide.#flush();
      } finally {
        this.#reading = false;
      }
    }
    this.#catchUp();
  }

  /**
   * Whether a pass can wait because the element is `far` from the screen
   * (more than a screen away): a first pass, or one for a new width or font,
   * when what is showing meanwhile can't change the element's height. One
   * line never wraps; more lines are held at their height once truncated. In
   * a long table, that is most rows. The pass runs once the element comes
   * near the screen, or as soon as anything is read from the instance.
   */
  #putOff(reason: ChangeReason, far: boolean): boolean {
    if (!far || this.#reading || !nearObserver || observed.get(this.element) !== this) return false;
    if (reason !== 'init' && reason !== 'resize' && reason !== 'fonts') return false;
    if (wraps(this.#settings.lines) ? this.#heightLock === null : reason === 'init' && !WRAP_MODE) return false;
    this.#owed ??= reason;
    return true;
  }

  /**
   * Content that `content-visibility: auto` stopped skipping: passes that
   * waited for it (see `pass`) run now. The ResizeObserver often can't tell:
   * the size it last reported is still right.
   */
  static #unskipped(event: Event) {
    if (!(event.target instanceof Element) || ('skipped' in event && event.skipped === true)) return;
    for (const line of event.target.querySelectorAll('[data-fp-text]')) {
      const instance = line.parentElement ? observed.get(line.parentElement) : undefined;
      if (instance && instance.#owed) instance.#schedule(instance.#owed);
    }
  }

  /** The shared IntersectionObserver: passes put off run as their elements come near. */
  static #neared(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const instance = observed.get(entry.target);
      if (!instance) continue;
      instance.#far = !entry.isIntersecting;
      if (!instance.#far && instance.#owed) instance.#schedule(instance.#owed);
    }
  }

  static #flush() {
    flushing = false;
    const batch = [...queued];
    queued.clear();
    Elide.#runAll(batch);
  }

  /** Run the passes in lockstep, then tell each instance's listeners. */
  static #runAll(batch: [Elide, ChangeReason][]) {
    if (batch.length === 0) return;
    const { results, failed } = lockstep(batch.map(([instance, reason]) => instance.#pass(reason)));
    if (unfound.size > 0) {
      if (finding !== null) clearTimeout(finding);
      finding = setTimeout(() => {
        finding = null;
        for (const instance of unfound) instance.#catchUp();
      }, FIND_DELAY);
    }
    results.forEach((result, i) => result && batch[i]![0].#finish(result));
    if (failed) throw failed.error;
  }

  /** The shared ResizeObserver: re-truncates every resized instance in one batch. */
  static #resized(entries: ResizeObserverEntry[]) {
    // The height reported, and whether the text was truncated then.
    const heights = new Map<Elide, { height: number; truncated: boolean | undefined }>();
    for (const entry of entries) {
      const instance = observed.get(entry.target);
      if (!instance) continue;
      const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      // Height changes are usually our own doing (fewer lines); only width
      // matters, and with `lines: 'fit'` a height other than the one fitted to.
      const fitted =
        instance.#settings.lines !== 'fit' || Math.abs((entry.borderBoxSize?.[0]?.blockSize ?? -1) - instance.#lastHeight) < 0.01;
      if (Math.abs(width - instance.#lastWidth) < 0.01 && fitted && !instance.#owed) continue;
      if (instance.#putOff('resize', instance.#far === true)) {
        instance.#clip(true);
        continue;
      }
      heights.set(instance, {
        height: entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
        truncated: instance.#current?.truncated,
      });
    }
    if (heights.size === 0) return;
    const batch = [...queued];
    queued.clear();
    const batched = new Set(batch.map(([instance]) => instance));
    for (const instance of heights.keys()) if (!batched.has(instance)) batch.push([instance, instance.#owed ?? 'resize']);
    Elide.#runAll(batch);
    // Truncating usually changes the height the observer just reported (the
    // old text was reflowed at the new width first). Left alone, that is an
    // undelivered notification, which browsers report as an error. Look away
    // until the next frame instead; picking up again reports the same width,
    // which is a no-op. (One line that can't wrap keeps its height, unless
    // an ellipsis came or went.)
    for (const [instance, { height, truncated }] of heights) {
      const host = instance.element;
      if (observed.get(host) !== instance) continue;
      if (WRAP_MODE && !wraps(instance.#settings.lines) && instance.#current?.truncated === truncated) continue;
      if (Math.abs(contentHeight(host) - height) <= 0.5) continue;
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
  *#pass(reason: ChangeReason): Pass<Painted | null> {
    const phase = new Phase();
    const host = this.element;
    this.#owed = null;
    if (this.#destroyed || !host.isConnected) return null;
    // Expanded text wraps as it likes: only a change of text or options needs a pass.
    if (this.#opener !== null && (reason === 'resize' || reason === 'fonts')) return null;
    // In content that `content-visibility: auto` skips, reading layout lays
    // it out there and then, one element at a time. Wait until it is
    // rendered: the ResizeObserver reports it then.
    if (!this.#reading && observed.get(host) === this && !host.checkVisibility?.({ contentVisibilityAuto: true })) {
      this.#owed = reason;
      yield* phase.write();
      this.#clip(true);
      return null;
    }
    if (host.getClientRects().length === 0) return null;

    // Once the IntersectionObserver has had its say, it decides: going by
    // the box instead can disagree right at the edge, and then nothing would
    // run the pass when it comes near (the observer has nothing new to say).
    const box = host.getBoundingClientRect();
    const far =
      this.#far ?? (box.bottom < -innerHeight || box.top > 2 * innerHeight || box.right < -innerWidth || box.left > 2 * innerWidth);
    if (this.#putOff(reason, far)) {
      yield* phase.write();
      this.#clip(true);
      return null;
    }
    const cs = getComputedStyle(host);
    const run = this.#prepare(cs, box);
    this.#lastWidth = run.width;
    const previous = this.#current;
    const reset = this.#pendingReset || !previous;
    const first = this.#joins[0]!;
    if (first.ellipsis.isConnected) this.#markLayout(run);
    const whiteSpace = cs.whiteSpace;
    // On one line, what is showing can be the first measurement to judge
    // cuts by (see `Predictor`): the cut last rendered, less the room
    // justifying added, or before the first pass, the full text.
    const { lines } = this.#settings;
    const predictable =
      !wraps(lines) &&
      WRAP_MODE &&
      this.#settings.justify !== 'spread' &&
      cs.direction === 'ltr' &&
      /^(start|left|justify)$/.test(cs.textAlign) &&
      this.#even &&
      this.#units.length === 0 &&
      this.#suffix === null &&
      !this.#revealed &&
      this.#tightened === 0 &&
      this.#forms.length === 0 &&
      this.#misjudged !== run.glyphs &&
      (this.#plain || this.#uniform(run));
    let base: { cut: Range[]; end: number } | null = null;
    // (Or the full text, when it has just been set and shows in full.)
    const fresh = this.#fresh;
    // The cut last rendered is spaced as this pass would space it, unless the font or the marks changed.
    const steady =
      reason !== 'update' &&
      reason !== 'fonts' &&
      !this.#pendingReset &&
      this.#lastRun?.glyphs === run.glyphs &&
      (this.#lastRun.marks === run.marks || !previous?.truncated);
    if (predictable && this.#g.length > 0 && (fresh || steady)) {
      const { end } = lineSpan([this.#lineEl], run.left, run.right);
      const added = fresh ? 0 : (previous?.gaps.reduce((sum, g) => sum + g.slack, 0) ?? 0);
      base = { cut: fresh ? [] : (previous?.hidden.map((p): Range => [p.start, p.end]) ?? []), end: end - added };
    }
    // Trying cuts that don't fit wraps the text, so the element grows (or
    // overflows) for a moment. Nobody sees it, but measuring lays it out, and
    // a browser that anchors the scroll position (most do) reacts to it,
    // firing a scroll event on every pass: on every frame of a resize, even
    // far off screen. Holding the element's height and clipping its overflow
    // while fitting keeps all of that inside. (Neither changes where anything
    // inside is laid out, and nothing paints before they're restored.) Lines
    // fitted to the height need it free to find how much room there is.
    const hold = cs.display !== 'inline' && cs.height.endsWith('px');
    const holdHeight = hold && lines !== 'fit';
    const height = cs.height;

    yield* phase.write();
    this.#pendingReset = false;
    this.#fresh = false;
    this.#steadyLines(whiteSpace);
    this.#clip(false);
    if (this.#revealed) this.#reveal(false);
    if (this.#unsaid) {
      speak(this.#srEl, this.element, this.#g, this.#chains, this.#units);
      this.#unsaid = false;
    }

    const tracker = this.#tracker;
    this.#lastRun = run;

    const n = this.#g.length;
    const { snap, trim } = this.#settings;
    let hidden: Range[] = [];
    let fit: Fit = { ok: false, lines: 0, max: 0, end: 0, room: 0 };
    const pinned = () => (this.#sought ? union([this.#sought.range, ...this.#pins]) : this.#pins);
    let pins = pinned();
    let gaps: GapInfo[] = [];
    let slack = 0;
    let plans: GapPlan[] = [];

    // Only while trying a cut that may not fit: one judged to fit needs neither.
    const held: (() => void)[] = [];
    const holdStill = () => {
      if (!hold || held.length > 0) return;
      held.push(holdStyle(host, 'overflow', 'clip'));
      if (holdHeight) held.push(holdStyle(host, 'height', height));
    };
    try {
      const layout = run.marks;
      // Places along the line, on one line: islands as long as fits before them.
      const islands = this.#placing && layout && !wraps(lines) ? this.#placed(run) : this.#layout;
      let predictor: Predictor | null = null;
      if (base && layout) {
        const model = {
          sums: run.sums,
          kerns: kerningOf(this.#g, run),
          neighbour: (i: number) => this.#neighbour(run, i),
          ...this.#spacing(run),
        };
        predictor = new Predictor(model, n, run.right, marginFor(run, layout.fontSize));
        predictor.saw(base.cut, base.end);
      }
      // Whether a cut was judged without being rendered, and so has yet to
      // be checked; and the cut last rendered and measured.
      let judged = false;
      let tried: Range[] | null = null;
      // The cut was justified where it was known to end (see below).
      let ahead = false;
      // The predictor has measured a cut of this pass: it judges the ones
      // around it as well as rendering them would, if it is close enough.
      let probed = false;
      // Short forms (see `shorten`): the steps the parts that may show shorter
      // take, how many show (`level`), and the edges that keep them whole. Not
      // while expanded, nor for a part find in page or focus keeps in sight.
      const sought = this.#sought?.range;
      const steps = this.#opener !== null ? [] : stepsOf(this.#forms, (f) => !!sought && f.start < sought[1] && sought[0] < f.end);
      let level = 0;
      let shortWholes: Edges | null = null;
      const cutting = (pins: readonly Range[]): Cutting => ({
        graphemes: this.#g,
        layout: islands,
        pins,
        snap,
        trim,
        wholes: this.#wholes ? bothEdges(this.#wholes, shortWholes) : shortWholes,
        context: contextOf(this.#g, this.#contexts, pins),
      });
      let cuts = cutting(pins);
      const at = (k: number) => this.#worthCutting(run, hiddenRanges(cuts, k));
      // What each cut tried so far did: different probes can come to the same cut.
      const outcomes = new Map<string, Tried>();
      const attempt = function* (this: Elide, cut: Range[]): Generator<void, Tried, void> {
        const key = cut.join();
        let tried = outcomes.get(key);
        if (tried === undefined) outcomes.set(key, (tried = yield* probe.call(this, cut)));
        return tried;
      };
      const probe = function* (this: Elide, cut: Range[]): Generator<void, Tried, void> {
        const sure = predictor?.fits(cut) ?? null;
        if (sure !== null) {
          judged = true;
          return { fits: sure, room: null };
        }
        yield* phase.write();
        holdStill();
        tried = cut;
        if (cut.length === 0) this.#renderFull(run);
        else this.#render(run, cut);
        yield* phase.read();
        fit = this.#measure(run);
        if (predictor) {
          predictor.saw(cut, fit.end);
          probed = true;
        }
        return { fits: fit.ok, room: fit.room };
      };
      // How much tighter `tighten` may set the text, and what tightening by a
      // pixel takes in up to each grapheme: a pixel after every letter, two
      // after every space (null: none).
      const most = toPx(this.#settings.tighten, run.fontSize);
      let units: Float64Array | null = most > 0 ? new Float64Array(n + 1) : null;
      if (units) for (let i = 0; i < n; i++) units[i + 1] = units[i]! + (this.#g[i] === ' ' || this.#g[i] === ' ' ? 3 : 1);
      // Firefox rounds letter-spacing to 1/60 px: rounded up, it fits, if a little short of the edge.
      const up = (by: number) => Math.ceil(by * 60 - 1e-6) / 60;
      /** Render `cut` (the full text, if empty) set `by` px tighter, and measure it. Whether it fits. */
      const set = function* (this: Elide, cut: Range[], by: number): Generator<void, boolean, void> {
        yield* phase.write();
        holdStill();
        if (cut.length > 0) {
          this.#render(run, cut, by);
        } else {
          if (tried?.length !== 0) this.#renderFull(run);
          this.#tighten(run, by);
        }
        tried = cut;
        yield* phase.read();
        fit = this.#measure(run);
        return fit.ok;
      };
      /**
       * Set `cut` (or the full text), which runs `over` the edge on one line
       * set as usual, as little tighter as fits: by how far it runs over,
       * over the `moving` units, then once more by how far that moved it.
       * Whether it fits.
       */
      const least = function* (this: Elide, cut: Range[], over: number, moving: number): Generator<void, boolean, void> {
        // A quarter pixel inside the edge, like a justified line.
        const need = over + 0.25;
        let by = need / moving;
        if (by > most) return false;
        if (yield* set.call(this, cut, Math.max(0, by))) return true;
        const moved = run.right + over - fit.end;
        by = moved > 0 ? up((by * need) / moved) : Infinity;
        return by <= most && (yield* set.call(this, cut, by));
      };
      /**
       * The full text, which runs over, set tighter until it fits (see
       * `tighten`), or not at all. On one line, as `least` does; on more, by
       * as much as it runs over and then by halving between that and the most.
       */
      const squeeze = function* (this: Elide): Generator<void, boolean, void> {
        if (!units) return false;
        const all = units[n]!;
        // How far it runs over, measured, if the glyph widths say it may be
        // close enough (with the leeway above). Never as judged: near the most,
        // a judgement and a measurement can fall either side of it, and which
        // one a pass has depends on the pass before.
        if (tried?.length !== 0) {
          const reserved = this.#settings.suffix?.show === 'truncated' ? 0 : run.suffix;
          const room = (run.right - run.left) * (lines === 'fit' ? 1 : lines) - reserved;
          if (run.sums[n]! - room > (most * all + 1) * 1.1) return false;
          // (Judged not to fit, it may yet.)
          if (yield* set.call(this, [], 0)) return true;
        }
        const over = -fit.room;
        if (!(over > 0) || over > most * all) return false;
        const by = Math.min(most, (over + 0.25) / all);
        if (!wraps(lines)) {
          if (yield* least.call(this, [], over, all)) return true;
        } else if (!(yield* set.call(this, [], by)) && (yield* set.call(this, [], most))) {
          let [lo, hi] = [by, most];
          for (let i = 0; i < 3; i++) {
            const mid = up((lo + hi) / 2);
            if (mid <= lo || mid >= hi) break;
            if (yield* set.call(this, [], mid)) hi = mid;
            else lo = mid;
          }
          return (fit.ok && this.#tightened === hi) || (yield* set.call(this, [], hi));
        }
        if (fit.ok) return true;
        yield* phase.write();
        this.#tighten(null, 0);
        return false;
      };
      /**
       * With `tightenCuts`, on one line: past the `k` graphemes a cut keeps
       * set as usual, as many more as fit set tighter by the most, by the
       * glyph widths less that and then as rendered (the search above); then
       * set as little tighter as they take (`least`). Null for the cut that
       * keeps `k`, set as usual.
       */
      const snug = function* (this: Elide, k: number, mark: number, room: number): Generator<void, Range[] | null, void> {
        const top = maxKept(cuts);
        const each = units;
        if (!each || !this.#settings.tightenCuts || wraps(lines) || this.#settings.justify === 'spread' || k >= top) return null;
        const tight = run.sums.map((w, i) => w - most * each[i]!);
        const kept = (width: number, near?: number) => estimateKept(cuts, tight, mark, width, near);
        const search = steeredSteps(k, top, Math.min(top, Math.max(k, kept(room)) + 1), (j, left) =>
          kept(keptWidth(tight, mark, at(j)) + left, j),
        );
        let step = search.next();
        while (!step.done) {
          yield* set.call(this, at(step.value), most);
          step = search.next({ fits: fit.ok, room: fit.room });
        }
        const cut = at(step.value);
        if (sameRanges(cut, at(k))) {
          // (What showed last was set tighter: it's rendered again as usual.)
          tried = null;
          return null;
        }
        if (!(fit.ok && tried !== null && sameRanges(tried, cut))) yield* set.call(this, cut, most);
        // Tightening moves the line by a pixel for each of these: not the
        // letters either side of an ellipsis, which keep its spacing (see `tighten`).
        const beside = cut.reduce((sum, [s, e]) => sum + (s > 0 ? each[s]! - each[s - 1]! : 0) + (e < n ? each[e + 1]! - each[e]! : 0), 0);
        const moving = Math.max(1, keptWidth(each, 0, cut) - beside);
        if (!(yield* least.call(this, cut, fit.end + most * moving - run.right, moving))) yield* set.call(this, cut, most);
        return cut;
      };
      const longUnits = units;
      // A short form's width by its glyph widths, and how much tightening by a pixel takes it in.
      const formWidth = (form: string) => graphemes(form).reduce((sum, g) => sum + glyphIn(run, g).advance, 0);
      const formUnits = (form: string) => graphemes(form).reduce((sum, g) => sum + (isWhitespace(g) ? 3 : 1), 0);
      const sumsAt = (short: readonly ShortPart[]) =>
        short.length > 0
          ? totals(
              n,
              (i) => run.long[i + 1]! - run.long[i]!,
              short,
              (p) => formWidth(p.form),
            )
          : run.long;
      /** Show the forms of the first `k` steps in what is rendered next, and size and cut the text as they show. */
      const toLevel = (k: number) => {
        level = k;
        const short = shortAt(this.#text, this.#offsets, this.#forms, steps, k);
        this.#short = short;
        run.sums = sumsAt(short);
        units =
          longUnits && short.length > 0
            ? totals(
                n,
                (i) => longUnits[i + 1]! - longUnits[i]!,
                short,
                (p) => formUnits(p.form),
              )
            : longUnits;
        shortWholes = short.length > 0 ? wholeEdges(n, shortRanges(short)) : null;
        tried = null;
        outcomes.clear();
      };
      // A judgement shouldn't be wrong, but if the final measurement says
      // the model was off, the cut is found again without judging (and this
      // text, set this way, isn't judged again).
      for (;;) {
        pins = pinned();
        cuts = cutting(pins);
        hidden = [];
        // Trying the full text means cancelling the ellipsis, so only do it
        // when the text might fit: its glyph widths summed can't exceed the
        // room on all lines (with some leeway for kerning and collapsed spaces).
        // How many lines fit the height shows once the full text is tried.
        const width = run.right - run.left;
        // (A suffix that only shows while truncated doesn't show with it.)
        const reserved = this.#settings.suffix?.show === 'truncated' ? 0 : run.suffix;
        /** Whether all of the text fits, as it shows now: set as usual, or tighter (see `tighten`). */
        const fitsWhole = function* (this: Elide): Generator<void, boolean, void> {
          return (
            ((lines === 'fit' || run.sums[n]! <= (width * lines - reserved) * 1.1 + 1) && (yield* attempt.call(this, [])).fits) ||
            (n > 0 && (yield* squeeze.call(this)))
          );
        };
        /**
         * The fewest steps of short forms that let all of the text fit,
         * showing: searched by halves, from the first whose glyph widths fit.
         * Whether any does; if none, every part shows its shortest form, to be cut.
         */
        const shorten = function* (this: Elide): Generator<void, boolean, void> {
          const top = steps.length;
          const fits = width * (lines === 'fit' ? fit.max : lines) - reserved;
          let k = 1;
          while (k < top && sumsAt(shortAt(this.#text, this.#offsets, this.#forms, steps, k))[n]! > fits) k++;
          // The most steps known not to fit, and the fewest known to (past the last: none).
          let [lo, hi] = [0, top + 1];
          while (hi - lo > 1) {
            toLevel(k);
            if (yield* fitsWhole.call(this)) hi = k;
            else lo = k;
            k = (lo + hi) >> 1;
          }
          if (hi <= top) {
            if (level === hi) return true;
            toLevel(hi);
            if (yield* fitsWhole.call(this)) return true;
          }
          if (level !== top) toLevel(top);
          return false;
        };
        if (level !== 0 || this.#short.length > 0) toLevel(0);
        const full = (yield* fitsWhole.call(this)) || (n > 0 && steps.length > 0 && (yield* shorten.call(this)));
        const room = width * (lines === 'fit' ? fit.max : lines) - run.suffix;
        if (!full && n > 0) {
          cuts = cutting(pins);
          // Kept parts that can't all fit give way, last first.
          while (pins.length > 0 && !(yield* attempt.call(this, at(0))).fits) {
            pins = giveWay(pins, this.#sought?.range ?? null);
            cuts = cutting(pins);
          }
          yield* phase.write();
          // Where the search starts: what the canvas widths say fits. Kerning,
          // wrapping and rounding make that a guess, but a steady one, so it
          // is shifted by how far off it was last time. From there each probe
          // aims at what the room it left (or lacked) says fits, by the same
          // widths: the room wrapping wastes changes little from one to the next.
          const mark = layout ? groupMetrics(layout, layout.inner).advance : 0;
          const kept = (width: number, near?: number) => estimateKept(cuts, run.sums, mark, width, near);
          const guess = kept(room);
          // One past the expected answer first: when the expectation holds,
          // the last probe is the answer, already rendered and measured.
          const most = maxKept(cuts);
          const first = Math.max(0, Math.min(most, guess + (this.#bias ?? 0) + 1));
          const search = steeredSteps(0, most, first, (k, left) => kept(keptWidth(run.sums, mark, at(k)) + left, k));
          let step = search.next();
          while (!step.done) step = search.next(yield* attempt.call(this, at(step.value)));
          this.#bias = step.value - guess;
          hidden = (yield* snug.call(this, step.value, mark, room)) ?? at(step.value);
        }
        const measured = fit.ok && tried !== null && sameRanges(tried, hidden);
        const expected = measured ? null : (predictor?.right(hidden) ?? null);
        // Judged by what showed before the pass, it's checked once rendered.
        const checked = expected !== null && !(probed && predictor!.close(SLIP));
        if (measured) {
          // Showing already, as measured. The full text, measured, may still
          // keep the ellipsis that was showing (out of the flow): it goes now.
          if (hidden.length === 0 && this.#joins[0]?.el.style.display !== 'none') {
            yield* phase.write();
            this.#showAll();
          }
          plans = this.#plan(run, hidden);
        } else {
          yield* phase.write();
          if (expected === null) holdStill();
          plans = this.#render(run, hidden);
          this.#label(hidden);
        }
        // On one line, which can't wrap, a cut measured or judged is justified
        // from where it ends, in the same write: a check, if any, is then the
        // one layout that sees it all.
        const end = measured && predictor ? fit.end : expected;
        ahead = end !== null && hidden.length > 0;
        if (ahead) ({ gaps, slack } = yield* justify(this.#justified(run, plans, 1, hidden, end), phase));
        const added = ahead ? gaps.reduce((sum, g) => sum + g.slack, 0) : 0;
        if (checked || (!measured && expected === null)) {
          yield* phase.read();
          fit = this.#measure(run);
        } else if (!measured) {
          fit = { ok: true, lines: 1, max: 1, end: expected! + added, room: 0 };
        }
        const off = checked && predictor!.off(expected + added, fit.end);
        if (off) this.#misjudged = run.glyphs;
        // Not off, the judgement holds (the cut fits by more than the
        // error), but the line may end a little off the edge: justified
        // again from where it turned out to end.
        if (checked && !off && ahead && Math.abs(expected + added - fit.end) > SLIP) {
          ({ gaps, slack } = yield* justify(this.#justified(run, plans, 1, hidden, fit.end - added), phase));
          fit = { ...fit, ok: true };
          break;
        }
        if ((fit.ok && !off) || !judged) break;
        predictor = null;
        judged = false;
        outcomes.clear();
      }
      if (hidden.length > 0 && !ahead) ({ gaps, slack } = yield* justify(this.#justified(run, plans, fit.lines, hidden), phase));
      yield* phase.write();
      this.#label(hidden);
      if (this.#sought !== null || this.#opener !== null) this.#fillFound(hidden);
      else unfound.add(this);
      if (this.#opener !== null) this.#reveal(true, hidden);
    } finally {
      for (const release of held.reverse()) release();
    }

    const state = this.#makeState(hidden, fit.lines, gaps, pins, slack, this.#tightened);
    this.#current = state;
    const lock = holdHeight && state.truncated && wraps(lines) && !this.#revealed;
    // A resize that leaves plain text on as many lines leaves its height as held.
    const same = lock && reason === 'resize' && this.#plain && this.#heightLock !== null && state.lines === this.#lockedLines;
    if (!same) {
      this.#unlockHeight();
      if (lock) {
        yield* phase.read();
        const natural = getComputedStyle(host).height;
        yield* phase.write();
        this.#lockHeight(natural);
        this.#lockedLines = state.lines;
      }
    }
    if (this.#focused) this.#markFocus();

    if (tracker) {
      yield* phase.read();
      tracker.painted(run, previous && !reset ? run.box : null);
    }
    return { reason, previous, state, reset, tracker };
  }

  /** Tell listeners about a finished pass. */
  #finish({ reason, previous, state, reset, tracker }: Painted) {
    tracker?.done(reason, previous, state, reset);
    for (const fn of this.#renderListeners) fn(state);
  }

  #makeState(
    hidden: readonly Range[],
    lines: number,
    gaps: GapInfo[],
    pins: readonly Range[] = this.#pins,
    slack = 0,
    tightened = 0,
  ): ElideState {
    return stateOf(this.#text, this.#offsets, {
      hidden,
      pins,
      lines,
      gaps,
      slack,
      expanded: this.#revealed,
      tightened,
      short: this.#short,
    });
  }

  static {
    openUp((e) => ({
      sync: () => e.#sync(),
      get settings() {
        return e.#settings;
      },
      get current() {
        return e.#current;
      },
      get run() {
        return e.#lastRun;
      },
      joins: e.#joins,
      line: e.#lineEl,
      get offsets() {
        return e.#offsets;
      },
      get glyphs() {
        return e.#glyphEls;
      },
      pieces: () => e.#layoutOf(e.#cut),
      track: (tracker) => {
        e.#tracker = tracker;
      },
    }));
  }
}

/** Truncate `element`'s text. Returns a live instance; call `destroy()` to undo. */
export function elide(element: HTMLElement, options?: ElideOptions): Elide {
  return new Elide(element, options);
}
