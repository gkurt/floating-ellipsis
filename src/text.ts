/**
 * Truncation without the DOM: fit a string into a width, for canvas, SVG,
 * chart labels, workers or the server. One line, measured with a canvas or
 * a `measure` function of your own.
 */
import {
  type Keep,
  type Position,
  type Range,
  type Snap,
  asArray,
  estimateKept,
  hiddenRanges,
  keepRanges,
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
}

export interface ElideTextResult {
  /** The text to show: what fits, with an ellipsis for each hidden part. */
  text: string;
  truncated: boolean;
  /** The hidden parts, one per ellipsis, in grapheme indices of the full text. */
  hidden: Part[];
  /** Kept parts (from `keep`) that show while truncated. */
  kept: Part[];
  /** The width of `text`, as measured. */
  width: number;
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
  const { width: room, font, letterSpacing = 0, position = 'end', keep = null, ellipsis = '…', trim = true, snap = null } = options;
  const raw = options.measure ?? (font ? (s: string) => advance(font, s) : null);
  if (!raw) throw new Error('elideText: pass a `font` or a `measure` function');
  const g = graphemes(text);
  const n = g.length;
  const measure = (s: string, count: number) => raw(s) + letterSpacing * count;

  const whole = measure(text, n);
  if (whole <= room) return { text, truncated: false, hidden: [], kept: [], width: whole };

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
  let pins = toGraphemeRanges(keepRanges(text, asArray(keep)), offsets);
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

  // A cut no wider than the ellipsis standing in for it only adds an ellipsis.
  const cutsFor = (k: number) => hiddenRanges(g, layout, k, pins, snap, trim).filter(([s, e]) => sums[e]! - sums[s]! > mark);
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
    return { text: out, width: measure(out, count) };
  };

  // Kept parts that can't all fit give way, last first, as in `elide`.
  while (pins.length > 0 && render(cutsFor(0)).width > room) pins = pins.slice(0, -1);
  // The glyph widths' estimate, then measured, since a string isn't just
  // the sum of its glyphs (kerning).
  let k = estimateKept(g, layout, pins, snap, trim, sums, mark, room);
  let cuts = cutsFor(k);
  let shown = render(cuts);
  while (shown.width > room && k > 0) {
    cuts = cutsFor(--k);
    shown = render(cuts);
  }
  while (k < n - 1) {
    const more = cutsFor(k + 1);
    const wider = render(more);
    if (wider.width > room) break;
    [k, cuts, shown] = [k + 1, more, wider];
  }
  if (cuts.length === 0) return { text, truncated: false, hidden: [], kept: [], width: whole };
  return { text: shown.text, truncated: true, hidden: cuts.map(part), kept: pins.map(part), width: shown.width };
}

export { separators, words } from './cut.ts';
export type { Keep, Place, Position, SeparatorOptions, Share, Snap, SnapContext } from './cut.ts';
export type { Part } from './options.ts';
