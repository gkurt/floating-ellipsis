/**
 * Judging single-line cuts without rendering them.
 *
 * On one line, where a cut's text ends follows from the glyph widths and the
 * gaps planned around each ellipsis, up to what layout adds (kerning,
 * mostly). One measurement of rendered text tells how much that is, and a
 * cut close to the one measured can then be judged without rendering it, as
 * long as it clears the edge by a safe margin either way. Each judgement
 * saved is a layout saved, which in a long table costs more with every row.
 */
import type { Range } from './cut.ts';
import { type GlyphMetrics, planGap } from './metrics.ts';

export interface WidthModel {
  /** Running total of advances: `sums[i]` is the width of graphemes [0, i). */
  sums: ArrayLike<number>;
  /** The glyph at `i` beside an ellipsis, or null for none (or whitespace). */
  neighbour: (i: number) => GlyphMetrics | null;
  /** The whole ellipsis, and the gap target on its sides. */
  group: GlyphMetrics;
  target: number | 'natural' | 'none';
}

/** The width of the text with `cut` hidden, each cut replaced by an ellipsis with its planned gaps. */
export function cutWidth(model: WidthModel, n: number, cut: readonly Range[]): number {
  const { sums, neighbour, group, target } = model;
  let width = sums[n]!;
  for (const [s, e] of cut) {
    const plan = planGap(neighbour(s - 1), group, neighbour(e), target);
    width += plan.marginLeft + group.advance + plan.marginRight - (sums[e]! - sums[s]!);
  }
  return width;
}

const shown = (n: number, cut: readonly Range[]) => cut.reduce((count, [s, e]) => count - (e - s), n);

/** Most graphemes a cut can show more or fewer than the one measured, and still be judged. */
const REACH = 4;

export class Predictor {
  private readonly model: WidthModel;
  private readonly n: number;
  /** Where the line must end, and how far a judged cut must stay from it. */
  private readonly edge: number;
  private readonly margin: number;
  private measured: { right: number; width: number; shown: number } | null = null;

  constructor(model: WidthModel, n: number, edge: number, margin: number) {
    this.model = model;
    this.n = n;
    this.edge = edge;
    this.margin = margin;
  }

  /** `cut`, rendered, ends at `right`. */
  saw(cut: readonly Range[], right: number): void {
    this.measured = { right, width: cutWidth(this.model, this.n, cut), shown: shown(this.n, cut) };
  }

  /** Whether `cut` fits, when that's certain enough; null when it has to be rendered to tell. */
  fits(cut: readonly Range[]): boolean | null {
    const m = this.measured;
    if (!m || Math.abs(shown(this.n, cut) - m.shown) > REACH) return null;
    const right = m.right + cutWidth(this.model, this.n, cut) - m.width;
    if (right <= this.edge - this.margin) return true;
    if (right >= this.edge + this.margin) return false;
    return null;
  }
}
