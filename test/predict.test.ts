import { describe, expect, it } from 'bun:test';
import type { GlyphMetrics } from '#src/metrics.ts';
import { Margin, Predictor, type WidthModel, cutWidth, kerningSums } from '#src/predict.ts';

const glyph = (advance: number): GlyphMetrics => ({ advance, left: 0, right: advance, ascent: 0, descent: 0 });

// Ten graphemes 10px wide, where the pair before grapheme `i` kerns by -i/10 px.
const n = 10;
const sums = Array.from({ length: n + 1 }, (_, i) => i * 10);
const kern = (i: number) => -i / 10;
const model = (kerns: ArrayLike<number>): WidthModel => ({
  sums,
  kerns,
  neighbour: () => glyph(10),
  group: glyph(12),
  target: 'none',
});

/** The width with `cut` hidden, pair by pair: what `cutWidth` adds up in one go. */
function slow(cut: [number, number][]): number {
  const shown = (i: number) => !cut.some(([s, e]) => i >= s && i < e);
  let width = cut.length * 12;
  for (let i = 0; i < n; i++) {
    if (!shown(i)) continue;
    width += 10;
    // Kerned with the grapheme before it, when nothing came between them.
    if (i > 0 && shown(i - 1)) width += kern(i);
  }
  return width;
}

describe('kerningSums', () => {
  it('totals the pairs inside [0, i)', () => {
    const kerns = kerningSums(n, kern);
    expect(kerns[0]).toBe(0);
    expect(kerns[1]).toBe(0);
    expect(kerns[2]).toBeCloseTo(-0.1);
    expect(kerns[n]).toBeCloseTo(-4.5);
  });
});

describe('cutWidth', () => {
  const kerns = kerningSums(n, kern);
  const cuts: [number, number][][] = [
    [],
    [[0, 3]],
    [[3, 6]],
    [[7, 10]],
    [[0, 10]],
    [
      [1, 3],
      [4, 8],
    ],
    [
      [2, 4],
      [5, 6],
    ],
    [
      [0, 1],
      [9, 10],
    ],
  ];

  it.each(cuts.map((c) => [JSON.stringify(c), c] as const))('drops the pairs a cut parts, %s', (_, cut) => {
    expect(cutWidth(model(kerns), n, cut)).toBeCloseTo(slow(cut));
  });
});

describe('Predictor', () => {
  const kerns = kerningSums(n, kern);

  it('places other cuts by the one measured, and judges those clear of the edge', () => {
    const p = new Predictor(model(kerns), n, 80, new Margin(0.5));
    expect(p.fits([[5, 8]])).toBeNull();
    // Rendered from 3px in, the whole text ends 3px past its width.
    p.saw([], slow([]) + 3);
    expect(p.right([[5, 8]])).toBeCloseTo(slow([[5, 8]]) + 3);
    expect(p.fits([[2, 6]])).toBe(true);
    expect(p.fits([[5, 7]])).toBe(false);
  });

  it('leaves a cut within the margin of the edge to be rendered', () => {
    const p = new Predictor(model(kerns), n, slow([[5, 8]]) + 0.2, new Margin(0.5));
    p.saw([], slow([]));
    expect(p.fits([[5, 8]])).toBeNull();
  });
});

describe('Margin', () => {
  it('stays cautious until checked often, then narrows to a few times the most it was off', () => {
    const margin = new Margin(0.75);
    for (let i = 0; i < 31; i++) margin.check(i % 2 === 1 ? 0.05 : -0.04);
    expect(margin.value).toBe(0.75);
    margin.check(0.01);
    expect(margin.value).toBeCloseTo(0.15);
    // Never past the cautious margin, nor under a tenth of a pixel.
    margin.check(0.4);
    expect(margin.value).toBe(0.75);
    const steady = new Margin(0.75);
    for (let i = 0; i < 40; i++) steady.check(0.001);
    expect(steady.value).toBe(0.1);
  });

  it('a check too far off says to stop judging the text', () => {
    const p = new Predictor(model(kerningSums(n, kern)), n, 80, new Margin(0.5));
    expect(p.off(70, 70.2)).toBe(false);
    expect(p.off(70, 70.3)).toBe(true);
  });
});
