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

export class Predictor {
  private readonly model: WidthModel;
  private readonly n: number;
  /** Where the line must end, and how far a judged cut must stay from it. */
  private readonly edge: number;
  readonly margin: number;
  private measured: { right: number; width: number } | null = null;

  constructor(model: WidthModel, n: number, edge: number, margin: number) {
    this.model = model;
    this.n = n;
    this.edge = edge;
    this.margin = margin;
  }

  /** `cut`, rendered, ends at `right`. */
  saw(cut: readonly Range[], right: number): void {
    this.measured = { right, width: cutWidth(this.model, this.n, cut) };
  }

  /** Where `cut` would end, rendered; null before a measurement. */
  right(cut: readonly Range[]): number | null {
    const m = this.measured;
    return m && m.right + cutWidth(this.model, this.n, cut) - m.width;
  }

  /** Whether `cut` fits, when that's certain enough; null when it has to be rendered to tell. */
  fits(cut: readonly Range[]): boolean | null {
    const right = this.right(cut);
    if (right === null) return null;
    if (right <= this.edge - this.margin) return true;
    if (right >= this.edge + this.margin) return false;
    return null;
  }
}
