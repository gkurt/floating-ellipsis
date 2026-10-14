import { describe, expect, it } from 'vitest';
import { type GlyphMetrics, columnGaps, inkGap, planGap, resolveGap } from '../src/metrics.js';

const glyph = (advance: number, left: number, right: number): GlyphMetrics => ({ advance, left, right, ascent: 0, descent: 0 });

// An 'o' with 1px side bearings, an 'l' with 2px ones, and an ellipsis with
// 1.5px side bearings.
const o = glyph(10, -1, 9);
const l = glyph(6, -2, 4);
const ell = glyph(15, -1.5, 13.5);

describe('inkGap', () => {
  it('is the distance between ink edges', () => {
    expect(inkGap(o, ell)).toBe(1 + 1.5);
    expect(inkGap(ell, l)).toBe(1.5 + 2);
  });
});

describe('planGap', () => {
  it('makes both sides equal to the target', () => {
    const plan = planGap(o, ell, l, 3);
    expect(plan.naturalLeft! + plan.marginLeft).toBeCloseTo(3);
    expect(plan.naturalRight! + plan.marginRight).toBeCloseTo(3);
  });

  it('natural keeps the total width', () => {
    const plan = planGap(o, ell, l, 'natural');
    expect(plan.target).toBeCloseTo(3);
    expect(plan.marginLeft + plan.marginRight).toBeCloseTo(0);
  });

  it('only adjusts sides that touch a glyph', () => {
    const plan = planGap(o, ell, null, 4);
    expect(plan.marginRight).toBe(0);
    expect(plan.naturalRight).toBeNull();
    expect(plan.naturalLeft! + plan.marginLeft).toBeCloseTo(4);
  });

  it('none leaves spacing alone', () => {
    expect(planGap(o, ell, l, 'none')).toMatchObject({ marginLeft: 0, marginRight: 0, target: null });
  });
});

describe('columnGaps', () => {
  const cols = (s: string) => [...s].map((c) => c === '#');
  it('finds the gaps between separate marks', () => {
    expect(columnGaps(cols('..###...###...###..'))).toEqual([3, 3]);
    expect(columnGaps(cols('##.###....#'))).toEqual([1, 4]);
  });
  it('has no gaps for a single mark', () => {
    expect(columnGaps(cols('..#####..'))).toEqual([]);
    expect(columnGaps(cols('....'))).toEqual([]);
  });
});

describe('resolveGap', () => {
  it('handles every form', () => {
    expect(resolveGap('dots', 16, () => 3)).toBe(3);
    expect(resolveGap('dots', 16, () => null)).toBe('natural');
    expect(resolveGap('0.25em', 16, () => null)).toBe(4);
    expect(resolveGap('2px', 16, () => null)).toBe(2);
    expect(resolveGap(5, 16, () => null)).toBe(5);
    expect(resolveGap('none', 16, () => null)).toBe('none');
  });
});
