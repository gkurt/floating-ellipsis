/**
 * Truncation without the DOM: fit a string into a width, for canvas, SVG,
 * chart labels, workers or the server. One line, measured with a canvas or
 * a `measure` function of your own.
 */
import {
  type Cutting,
  type Keep,
  type Position,
  type Range,
  type Snap,
  type Whole,
  asArray,
  contextOf,
  estimateKept,
  hiddenRanges,
  keepContexts,
  keepRanges,
  maxKept,
  wholeEdges,
  isPlace,
  layoutFor,
  placedLayout,
  placesOf,
  toGraphemeRanges,
} from './cut.ts';
import { graphemes, isWhitespace } from './graphemes.ts';
import { advance } from './metrics.ts';
import type { Part } from './options.ts';

export interface ElideTextOptions {
  /** The room the text has, in px (or whatever unit `measure` returns). */
  width: number;
  /**
   * A CSS font shorthand, like `'14px Inter'` or `'bold 12px/1 system-ui'`,
   * to measure with a canvas. Needed unless `measure` is given.
   */
  font?: string;
  /**
   * The width of a string. Defaults to a canvas measuring in `font`. Pass
   * one where there's no canvas (on the server), or to match a renderer.
   */
  measure?: (text: string) => number;
  /** Space after every grapheme, as CSS `letter-spacing` adds. Default 0. */
  letterSpacing?: number;
  /** Where the ellipsis goes, as in `elide`: a place is along `width` ('%', px, or em of `font`'s size). Default 'end'. */
  position?: Position | readonly Position[];
  /** Parts that always stay visible, as in `elide`. */
  keep?: Keep | readonly Keep[] | null;
  /** The ellipsis. Default '…'. */
  ellipsis?: string;
  /** Drop whitespace touching an ellipsis. Default true. */
  trim?: boolean;
  /** Move cuts to nicer boundaries: `separators()`, `words()`. */
  snap?: Snap | null;
  /** Parts shown whole or not at all, as in `elide`. */
  whole?: Whole | readonly Whole[] | null;
  /**
   * Text that runs over by a little shows whole, set tighter, as in
   * `elide`: by up to this much letter-spacing (in `measure`'s unit), and
   * twice that on word spaces. Default 0.
   */
  tighten?: number;
  /** A cut is set tighter too, by up to `tighten`, to show as much more as that makes room for. Default false. */
  tightenCuts?: boolean;
}

export interface ElideTextResult {
  /** The text to show: what fits, with an ellipsis for each hidden part. */
  text: string;
  truncated: boolean;
  /** The hidden parts, one per ellipsis, in grapheme indices of the full text. */
  hidden: Part[];
  /** Kept parts (from `keep`) that show while truncated. */
  kept: Part[];
  /** The width of `text`, as measured (tightened, if it was). */
  width: number;
  /**
   * How much closer `tighten` sets the letters for the text to fit: set
   * letter-spacing this much tighter, and word-spacing twice that. 0 when
   * it isn't tightened.
   */
  tightened: number;
}

/**
 * Fit `text` into `options.width` on one line, with the ellipsis wherever
 * `position` puts it: the same cuts `elide` makes, as a string.
 *
 * ```js
 * elideText('/Users/ada/notes/2026/tables.md', { width: 120, font: '13px Inter', position: 'middle' }).text;
 * ```
 */
export function elideText(text: string, options: ElideTextOptions): ElideTextResult {
  const {
    width: room,
    font,
    letterSpacing = 0,
    position = 'end',
    keep = null,
    ellipsis = '…',
    trim = true,
    snap = null,
    tighten = 0,
    tightenCuts = false,
  } = options;
  const raw = options.measure ?? (font ? (s: string) => advance(font, s) : null);
  if (!raw) throw new Error('elideText: pass a `font` or a `measure` function');
  const g = graphemes(text);
  const n = g.length;
  const measure = (s: string, count: number) => raw(s) + letterSpacing * count;

  const full = measure(text, n);
  if (full <= room) return { text, truncated: false, hidden: [], kept: [], width: full, tightened: 0 };
  // A pixel of tightening takes in one after every letter and two after every space.
  const unitsOf = (gs: readonly string[]) => gs.reduce((sum, s) => sum + (s === ' ' || s === ' ' ? 3 : 1), 0);
  const units = unitsOf(g);
  if (full - room <= tighten * units)
    return { text, truncated: false, hidden: [], kept: [], width: room, tightened: (full - room) / units };

  const offsets = [0];
  for (const s of g) offsets.push(offsets[offsets.length - 1]! + s.length);
  const sizes = new Map<string, number>();
  const sums = new Float64Array(n + 1);
  g.forEach((s, i) => {
    let w = sizes.get(s);
    if (w === undefined) sizes.set(s, (w = measure(s, 1)));
    sums[i + 1] = sums[i]! + w;
  });
  const mark = measure(ellipsis, graphemes(ellipsis).length);
  const graphemeRanges = (r: Range) => toGraphemeRanges([r], offsets);
  const contexts = keepContexts(text, asArray(keep)).flatMap(([r, words]) => graphemeRanges(r).map((x): [Range, number] => [x, words]));
  const wholes = wholeEdges(n, keepRanges(text, asArray(options.whole)).flatMap(graphemeRanges));
  const positions = asArray(position);
  // Places along the line: islands as long as fits before them (see `elide`).
  const em = Number(/(\d*\.?\d+)px/.exec(font ?? '')?.[1] ?? 16);
  const places = positions.some(isPlace) ? placesOf(positions, 0, room, room, mark, em) : null;
  const span = (s: number, e: number) => {
    if (trim) {
      while (s < e && isWhitespace(g[s])) s++;
      while (e > s && isWhitespace(g[e - 1])) e--;
    }
    return e > s ? sums[e]! - sums[s]! : 0;
  };
  const layout = places
    ? placedLayout(n, places, 0, room, (i, s, e) => span(s, e) <= places[i]! - mark / 2 - (i === 0 ? 0 : places[i - 1]! + mark / 2))
    : layoutFor(n, positions);
  const part = ([start, end]: Range): Part => ({ start, end, text: text.slice(offsets[start], offsets[end]) });

  const cutting = (pins: readonly Range[]): Cutting => ({
    graphemes: g,
    layout,
    pins,
    snap,
    trim,
    wholes,
    context: contextOf(g, contexts, pins),
  });
  let c = cutting(toGraphemeRanges(keepRanges(text, asArray(keep)), offsets));
  // A cut no wider than the ellipsis standing in for it only adds an ellipsis.
  const cutsFor = (k: number) => hiddenRanges(c, k).filter(([s, e]) => sums[e]! - sums[s]! > mark);
  const render = (cuts: readonly Range[]) => {
    let out = '';
    let at = 0;
    let count = 0;
    for (const [s, e] of cuts) {
      out += text.slice(offsets[at], offsets[s]) + ellipsis;
      count += s - at;
      at = e;
    }
    out += text.slice(offsets[at]);
    count += n - at + cuts.length * graphemes(ellipsis).length;
    const width = measure(out, count);
    // How far it can be set tighter, with `tightenCuts`.
    const give = tightenCuts ? tighten * unitsOf(graphemes(out)) : 0;
    return { text: out, width, fits: width - give <= room };
  };

  // Kept parts that can't all fit give way, last first, as in `elide`.
  while (c.pins.length > 0 && !render(cutsFor(0)).fits) c = cutting(c.pins.slice(0, -1));
  // The glyph widths' estimate, then measured, since a string isn't just
  // the sum of its glyphs (kerning).
  const most = maxKept(c);
  let k = estimateKept(c, sums, mark, room);
  let cuts = cutsFor(k);
  let shown = render(cuts);
  while (!shown.fits && k > 0) {
    cuts = cutsFor(--k);
    shown = render(cuts);
  }
  while (k < most) {
    const more = cutsFor(k + 1);
    const wider = render(more);
    if (!wider.fits) break;
    [k, cuts, shown] = [k + 1, more, wider];
  }
  if (cuts.length === 0) return { text, truncated: false, hidden: [], kept: [], width: full, tightened: 0 };
  const tightened = shown.width > room ? (shown.width - room) / unitsOf(graphemes(shown.text)) : 0;
  return {
    text: shown.text,
    truncated: true,
    hidden: cuts.map(part),
    kept: c.pins.map(part),
    width: Math.min(shown.width, room),
    tightened,
  };
}

export { separators, words } from './cut.ts';
export type { Keep, Place, Position, SeparatorOptions, Share, Snap, SnapContext, Whole } from './cut.ts';
export type { Part } from './options.ts';
