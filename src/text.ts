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
  bothEdges,
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
import { graphemes, isCJK, isWhitespace } from './graphemes.ts';
import { advance } from './metrics.ts';
import type { Part } from './options.ts';
import { type ShortPart, type Shorten, formsOf, shortAt, shortRanges, shownText, stepsOf, totals } from './shorten.ts';

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
  /** The ellipsis. Default '…'. 'auto': '⋯', the midline ellipsis, for Chinese and Japanese text, '…' for any other. */
  ellipsis?: string;
  /** Drop whitespace touching an ellipsis. Default true. */
  trim?: boolean;
  /** Move cuts to nicer boundaries: `separators()`, `words()`. */
  snap?: Snap | null;
  /** Parts shown whole or not at all, as in `elide`. */
  whole?: Whole | readonly Whole[] | null;
  /** Parts that show shorter before any text is cut, as in `elide`. */
  shorten?: Shorten | readonly Shorten[] | null;
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
  /** The parts that show in a short form (see `shorten`), in grapheme indices of the full text. */
  short: ShortPart[];
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
 * `position` puts it: the same truncation `elide` makes, as a string.
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
    ellipsis: chosen = '…',
    trim = true,
    snap = null,
    tighten = 0,
    tightenCuts = false,
  } = options;
  const raw = options.measure ?? (font ? (s: string) => advance(font, s) : null);
  if (!raw) throw new Error('elideText: pass a `font` or a `measure` function');
  const g = graphemes(text);
  const n = g.length;
  const ellipsis = chosen === 'auto' ? (isCJK(g) ? '⋯' : '…') : chosen;
  const measure = (s: string, count: number) => raw(s) + letterSpacing * count;

  const offsets = [0];
  for (const s of g) offsets.push(offsets[offsets.length - 1]! + s.length);
  // A pixel of tightening takes in one after every letter and two after every space.
  const unitsOf = (gs: readonly string[]) => gs.reduce((sum, s) => sum + (s === ' ' || s === ' ' ? 3 : 1), 0);
  // All of the text, with the fewest steps of short forms that fit, set tighter if it takes that.
  const forms = formsOf(text, offsets, asArray(options.shorten));
  const steps = stepsOf(forms);
  for (let level = 0; level <= steps.length; level++) {
    const short = shortAt(text, offsets, forms, steps, level);
    const shown = shownText(g, short, 0, n);
    const gs = short.length > 0 ? graphemes(shown) : g;
    const width = measure(shown, gs.length);
    if (width <= room) return { text: shown, truncated: false, hidden: [], kept: [], short, width, tightened: 0 };
    const units = unitsOf(gs);
    if (width - room <= tighten * units)
      return { text: shown, truncated: false, hidden: [], kept: [], short, width: room, tightened: (width - room) / units };
  }

  // Cut with every part in its shortest form.
  const short = shortAt(text, offsets, forms, steps, steps.length);
  const sizes = new Map<string, number>();
  const size = (s: string) => {
    let w = sizes.get(s);
    if (w === undefined) sizes.set(s, (w = measure(s, graphemes(s).length)));
    return w;
  };
  const sums = totals(
    n,
    (i) => size(g[i]!),
    short,
    (p) => size(p.form),
  );
  const mark = measure(ellipsis, graphemes(ellipsis).length);
  const graphemeRanges = (r: Range) => toGraphemeRanges([r], offsets);
  const contexts = keepContexts(text, asArray(keep)).flatMap(([r, words]) => graphemeRanges(r).map((x): [Range, number] => [x, words]));
  const given = wholeEdges(n, keepRanges(text, asArray(options.whole)).flatMap(graphemeRanges));
  const wholes = given ? bothEdges(given, wholeEdges(n, shortRanges(short))) : wholeEdges(n, shortRanges(short));
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
    for (const [s, e] of cuts) {
      out += shownText(g, short, at, s) + ellipsis;
      at = e;
    }
    out += shownText(g, short, at, n);
    const gs = graphemes(out);
    const width = measure(out, gs.length);
    // How far it can be set tighter, with `tightenCuts`.
    const give = tightenCuts ? tighten * unitsOf(gs) : 0;
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
  const showing = short.filter((p) => !cuts.some(([s, e]) => s <= p.start && p.end <= e));
  if (cuts.length === 0)
    return { text: shown.text, truncated: false, hidden: [], kept: [], short: showing, width: shown.width, tightened: 0 };
  const tightened = shown.width > room ? (shown.width - room) / unitsOf(graphemes(shown.text)) : 0;
  return {
    text: shown.text,
    truncated: true,
    hidden: cuts.map(part),
    kept: c.pins.map(part),
    short: showing,
    width: Math.min(shown.width, room),
    tightened,
  };
}

export { separators, words } from './cut.ts';
export type { Keep, Place, Position, SeparatorOptions, Share, Snap, SnapContext, Whole } from './cut.ts';
export type { Part } from './options.ts';
export type { ShortPart, Shorten } from './shorten.ts';
