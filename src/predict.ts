/**
 * Judging single-line cuts without rendering them.
 *
 * On one line, where a cut's text ends follows from the glyph widths, the
 * kerning between neighbours and the gaps planned around each ellipsis, up
 * to rounding. One measurement of rendered text places all of that on the
 * page, and any other cut can then be judged without rendering it, as long
 * as it clears the edge by a safe margin either way. Each judgement saved is
 * a layout saved, which in a long table costs more with every row. What the
 * model misses (ligatures of three letters, whitespace that collapses, CSS
 * that turns kerning off) shows when the cut it picked is measured.
 */
import type { Range } from './cut.ts';
import { type GlyphMetrics, type Typeset, glyphIn, kerning, planGap } from './metrics.ts';

export interface WidthModel {
  /** Running total of advances: `sums[i]` is the width of graphemes [0, i). */
  sums: ArrayLike<number>;
  /**
   * Running total of kerning: `kerns[i]` is what the pairs of graphemes in
   * [0, i) add to their advances (see `kerningSums`).
   */
  kerns: ArrayLike<number>;
  /** The glyph at `i` beside an ellipsis, or null for none (or whitespace). */
  neighbour: (i: number) => GlyphMetrics | null;
  /** The whole ellipsis, and the gap target on its sides. */
  group: GlyphMetrics;
  target: number | 'natural' | 'none';
}

/** The width of the text with `cut` hidden, each cut replaced by an ellipsis with its planned gaps. */
export function cutWidth(model: WidthModel, n: number, cut: readonly Range[]): number {
  const { sums, kerns, neighbour, group, target } = model;
  let width = sums[n]! + kerns[n]!;
  for (const [s, e] of cut) {
    const plan = planGap(neighbour(s - 1), group, neighbour(e), target);
    // The pairs that lose a grapheme to the cut, the ones either side of it among them.
    const kerning = kerns[Math.min(n, e + 1)]! - kerns[Math.max(0, s)]!;
    width += plan.marginLeft + group.advance + plan.marginRight - (sums[e]! - sums[s]!) - kerning;
  }
  return width;
}

/**
 * Running total of what kerning adds to the graphemes' advances (`kern(i)`:
 * the pair of graphemes `i - 1` and `i`): `kerns[i]` covers the pairs in [0, i).
 */
export function kerningSums(n: number, kern: (i: number) => number): Float64Array {
  const kerns = new Float64Array(n + 1);
  for (let i = 1; i < n; i++) kerns[i + 1] = kerns[i]! + kern(i);
  return kerns;
}

/** The running totals for each text's graphemes, as last set (see `advanceSums`). */
const totals = new WeakMap<readonly string[], { glyphs: Typeset['glyphs']; sums: Float64Array; kerns: Float64Array | null }>();

/**
 * Running total of the advances of graphemes `g` as `typeset` sets them:
 * `sums[i]` is the width of graphemes [0, i). Kept while the graphemes and
 * how they're set stay the same.
 */
export function advanceSums(g: readonly string[], typeset: Typeset): Float64Array {
  const kept = totals.get(g);
  if (kept?.glyphs === typeset.glyphs) return kept.sums;
  const sums = new Float64Array(g.length + 1);
  for (let i = 0; i < g.length; i++) sums[i + 1] = sums[i]! + glyphIn(typeset, g[i]!).advance;
  totals.set(g, { glyphs: typeset.glyphs, sums, kerns: null });
  return sums;
}

/** `kerningSums` for graphemes `g` as `typeset` sets them, kept along with `advanceSums`. */
export function kerningOf(g: readonly string[], typeset: Typeset): Float64Array {
  advanceSums(g, typeset);
  const kept = totals.get(g)!;
  kept.kerns ??= kerningSums(g.length, (i) => kerning(typeset, g[i - 1]!, g[i]!));
  return kept.kerns;
}

/** Checks it takes before a margin narrows to what they found. */
const CHECKS = 32;

/**
 * How far a judged cut must stay from the edge, for one way of setting text.
 * At first a cautious share of the font size. Every judgement that gets
 * rendered checks the model; once it has been checked often enough, the
 * margin is a few times the most it was off (seldom a tenth of a pixel,
 * though engines differ), and fewer cuts need rendering to tell.
 */
export class Margin {
  #most = 0;
  #checked = 0;
  readonly #cautious: number;

  constructor(cautious: number) {
    this.#cautious = cautious;
  }

  get value(): number {
    return this.#checked < CHECKS ? this.#cautious : Math.min(this.#cautious, Math.max(0.1, 3 * this.#most));
  }

  /** The most a judgement has been off, in px. */
  get most(): number {
    return this.#most;
  }

  /** A judgement turned out `error` px off. */
  check(error: number): void {
    this.#most = Math.max(this.#most, Math.abs(error));
    this.#checked++;
  }
}

/** The margin for each way of setting text (by its glyph metrics, which go when fonts load). */
const margins = new WeakMap<Typeset['glyphs'], Margin>();

/** The margin for text set by `typeset` at `fontSize`. */
export function marginFor(typeset: Typeset, fontSize: number): Margin {
  let margin = margins.get(typeset.glyphs);
  if (!margin) margins.set(typeset.glyphs, (margin = new Margin(0.05 * fontSize + 0.1)));
  return margin;
}

export class Predictor {
  readonly #model: WidthModel;
  readonly #n: number;
  /** Where the line must end, and how far a judged cut must stay from it. */
  readonly #edge: number;
  readonly #margin: Margin;
  #measured: { right: number; width: number } | null = null;

  constructor(model: WidthModel, n: number, edge: number, margin: Margin) {
    this.#model = model;
    this.#n = n;
    this.#edge = edge;
    this.#margin = margin;
  }

  /** `cut`, rendered, ends at `right`. */
  saw(cut: readonly Range[], right: number): void {
    const expected = this.right(cut);
    if (expected !== null) this.#margin.check(expected - right);
    this.#measured = { right, width: cutWidth(this.#model, this.#n, cut) };
  }

  /**
   * Text expected to end at `expected` ends at `right`: whether the model
   * was too far off to go on judging this text by it.
   */
  off(expected: number, right: number): boolean {
    const margin = this.#margin.value;
    this.#margin.check(expected - right);
    return Math.abs(expected - right) > margin / 2;
  }

  /** Where `cut` would end, rendered; null before a measurement. */
  right(cut: readonly Range[]): number | null {
    const m = this.#measured;
    return m && m.right + cutWidth(this.#model, this.#n, cut) - m.width;
  }

  /**
   * Whether cuts judged near one measured end where judged, give or take
   * `slip`: no judgement of text set this way has been further off. (WebKit
   * on Linux is off by up to half a pixel.)
   */
  close(slip: number): boolean {
    return this.#margin.most <= slip;
  }

  /** Whether `cut` fits, when that's certain enough; null when it has to be rendered to tell. */
  fits(cut: readonly Range[]): boolean | null {
    const right = this.right(cut);
    if (right === null) return null;
    const margin = this.#margin.value;
    if (right <= this.#edge - margin) return true;
    if (right >= this.#edge + margin) return false;
    return null;
  }
}
