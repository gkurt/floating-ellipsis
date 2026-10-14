import { describe, expect, it } from 'vitest';
import { positionValue, rawCut, refineCut, searchMax, separators } from '../src/cut.js';
import { graphemes } from '../src/graphemes.js';

describe('rawCut', () => {
  it('splits the kept budget by position', () => {
    expect(rawCut(10, 4, 0.5)).toEqual({ start: 2, end: 8 });
    expect(rawCut(10, 4, 0)).toEqual({ start: 0, end: 6 });
    expect(rawCut(10, 4, 1)).toEqual({ start: 4, end: 10 });
    expect(rawCut(10, 0, 0.5)).toEqual({ start: 0, end: 10 });
  });

  it('only ever grows head and tail as the budget grows', () => {
    for (const p of [0, 0.2, 0.5, 0.73, 1]) {
      let prev = rawCut(50, 0, p);
      for (let k = 1; k < 50; k++) {
        const c = rawCut(50, k, p);
        expect(c.start).toBeGreaterThanOrEqual(prev.start);
        expect(c.end).toBeLessThanOrEqual(prev.end);
        prev = c;
      }
    }
  });
});

describe('positionValue', () => {
  it('maps keywords and clamps numbers', () => {
    expect(positionValue('start')).toBe(0);
    expect(positionValue('middle')).toBe(0.5);
    expect(positionValue('end')).toBe(1);
    expect(positionValue(2)).toBe(1);
    expect(positionValue(-1)).toBe(0);
  });
});

describe('refineCut', () => {
  const g = graphemes('Hello wide world');
  it('trims whitespace next to the ellipsis', () => {
    expect(refineCut(g, { start: 6, end: 10 }, 0.5, null, true)).toEqual({ start: 5, end: 11 });
    expect(refineCut(g, { start: 6, end: 10 }, 0.5, null, false)).toEqual({ start: 6, end: 10 });
  });

  it('never lets a snap reveal more text', () => {
    const greedy = () => ({ start: 100, end: 0 });
    expect(refineCut(g, { start: 3, end: 12 }, 0.5, greedy, false)).toEqual({ start: 3, end: 12 });
  });
});

describe('separators', () => {
  const path = graphemes('/abc/def/ghj/klm/nop');
  const snap = separators('/');
  const show = (c: { start: number; end: number }) => path.slice(0, c.start).join('') + '…' + path.slice(c.end).join('');

  it('cuts at path segments', () => {
    const raw = rawCut(path.length, 12, 0.5); // "/abc/d" … "lm/nop"
    expect(show(raw)).toBe('/abc/d…lm/nop');
    expect(show(refineCut(path, raw, 0.5, snap, true))).toBe('/abc/…/nop');
    const wider = rawCut(path.length, 16, 0.5); // "/abc/def" … "/klm/nop"
    expect(show(refineCut(path, wider, 0.5, snap, true))).toBe('/abc/…/klm/nop');
  });

  it('falls back to the plain cut where no separator is in reach', () => {
    const g = graphemes('abcdef/xyz');
    expect(refineCut(g, { start: 3, end: 8 }, 0.5, separators('/'), true)).toEqual({ start: 3, end: 8 });
  });

  it('does word boundaries with a space', () => {
    const g = graphemes('The quick brown fox');
    const c = refineCut(g, { start: 7, end: 14 }, 0.5, separators(' '), true);
    expect(g.slice(0, c.start).join('') + '…' + g.slice(c.end).join('')).toBe('The…fox');
  });

  it('accepts a RegExp', () => {
    const g = graphemes('a.b-c');
    const c = refineCut(g, { start: 3, end: 4 }, 0.5, separators(/[.-]/g), false);
    expect(c).toEqual({ start: 2, end: 4 });
  });
});

describe('searchMax', () => {
  const limit = (max: number) => {
    let calls = 0;
    const fits = (k: number) => {
      calls++;
      return k <= max;
    };
    return { fits, calls: () => calls };
  };

  it('finds the largest fitting value', () => {
    for (const max of [0, 1, 7, 63, 99]) {
      expect(searchMax(0, 99, limit(max).fits)).toBe(max);
    }
  });

  it('uses the hint from either side', () => {
    for (const hint of [0, 10, 40, 41, 42, 90, 99]) {
      expect(searchMax(0, 99, limit(41).fits, hint)).toBe(41);
    }
  });

  it('needs few probes when the hint is close', () => {
    const near = limit(41);
    searchMax(0, 999, near.fits, 40);
    expect(near.calls()).toBeLessThanOrEqual(4);
    const cold = limit(41);
    searchMax(0, 999, cold.fits);
    expect(cold.calls()).toBeGreaterThan(5);
  });
});

describe('graphemes', () => {
  it('keeps clusters together', () => {
    expect(graphemes('a👩‍👩‍👧b')).toEqual(['a', '👩‍👩‍👧', 'b']);
    expect(graphemes('é')).toHaveLength(1);
  });
});
