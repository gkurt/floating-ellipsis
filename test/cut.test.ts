import { describe, expect, it } from 'bun:test';
import {
  type Range,
  allocationOrder,
  complement,
  hiddenRanges,
  islands,
  keepRanges,
  layoutFor,
  positionValue,
  searchMax,
  separators,
  showSlivers,
  type SeparatorOptions,
  subtract,
  toGraphemeRanges,
  union,
} from '#src/cut.ts';
import { graphemes } from '#src/graphemes.ts';

/** Render hidden ranges as text with '…' in their place. */
const show = (g: readonly string[], hidden: readonly Range[]) => {
  let out = '';
  let at = 0;
  for (const [s, e] of hidden) {
    out += g.slice(at, s).join('') + '…';
    at = e;
  }
  return out + g.slice(at).join('');
};

describe('positionValue', () => {
  it('maps keywords and clamps numbers', () => {
    expect(positionValue('start')).toBe(0);
    expect(positionValue('middle')).toBe(0.5);
    expect(positionValue('end')).toBe(1);
    expect(positionValue(2)).toBe(1);
    expect(positionValue(-1)).toBe(0);
  });
});

describe('allocationOrder', () => {
  it('takes turns in proportion to the weights', () => {
    expect([...allocationOrder([0.5, 0.5], 6)]).toEqual([0, 1, 0, 1, 0, 1]);
    const counts = [0, 0, 0];
    for (const i of allocationOrder([0.25, 0.5, 0.25], 100)) counts[i]!++;
    expect(counts).toEqual([25, 50, 25]);
  });

  it('never feeds a zero-weight island', () => {
    expect([...allocationOrder([0, 1], 5)]).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('islands', () => {
  it('splits head and tail for one ellipsis', () => {
    const layout = layoutFor(10, ['middle']);
    expect(islands(layout, 4)).toEqual([
      [0, 2],
      [8, 10],
    ]);
    expect(islands(layoutFor(10, ['start']), 4)).toEqual([[6, 10]]);
    expect(islands(layoutFor(10, ['end']), 4)).toEqual([[0, 4]]);
    expect(islands(layout, 0)).toEqual([]);
  });

  it('centres middle islands for several ellipses', () => {
    const layout = layoutFor(20, [0.25, 0.75]);
    const parts = islands(layout, 8);
    expect(parts).toEqual([
      [0, 2],
      [8, 12],
      [18, 20],
    ]);
  });

  it('only ever grows as the budget grows', () => {
    for (const positions of [['middle'], [0.3], [0.2, 0.6], [0, 0.5, 1], [0.1, 0.4, 0.8]] as const) {
      const layout = layoutFor(40, positions);
      let prev = new Set<number>();
      for (let k = 0; k < 40; k++) {
        const now = new Set<number>();
        for (const [s, e] of islands(layout, k)) for (let i = s; i < e; i++) now.add(i);
        for (const i of prev) expect(now.has(i)).toBe(true);
        prev = now;
      }
    }
  });
});

describe('range helpers', () => {
  it('union merges overlapping and touching ranges', () => {
    expect(
      union([
        [5, 7],
        [0, 2],
        [2, 3],
        [6, 9],
      ]),
    ).toEqual([
      [0, 3],
      [5, 9],
    ]);
  });
  it('complement fills the holes', () => {
    expect(
      complement(10, [
        [2, 4],
        [6, 7],
      ]),
    ).toEqual([
      [0, 2],
      [4, 6],
      [7, 10],
    ]);
    expect(complement(3, [[0, 3]])).toEqual([]);
  });
  it('subtract carves cutouts out', () => {
    expect(subtract([[0, 10]], [[3, 5]])).toEqual([
      [0, 3],
      [5, 10],
    ]);
    expect(
      subtract(
        [
          [0, 4],
          [6, 9],
        ],
        [[3, 7]],
      ),
    ).toEqual([
      [0, 3],
      [7, 9],
    ]);
  });
});

describe('hiddenRanges', () => {
  const g = graphemes('Hello wide world');

  it('trims whitespace next to the ellipsis', () => {
    const layout = layoutFor(g.length, ['middle']);
    // 12 kept: "Hello " + " world" → the spaces next to the cut go.
    const hidden = hiddenRanges(g, layout, 12, [], null, true);
    expect(show(g, hidden)).toBe('Hello…world');
    expect(show(g, hiddenRanges(g, layout, 12, [], null, false))).toBe('Hello … world');
  });

  it('ignores a snap that leaves nothing to hide', () => {
    const empty = () => ({ start: 100, end: 0 });
    const layout = layoutFor(g.length, ['middle']);
    expect(hiddenRanges(g, layout, 6, [], empty, false)).toEqual(hiddenRanges(g, layout, 6, [], null, false));
  });

  it('keeps pinned parts, splitting the cut around them', () => {
    const text = graphemes('The quick brown fox jumps over the lazy dog');
    const layout = layoutFor(text.length, ['end']);
    const fox = text.join('').indexOf('fox');
    const hidden = hiddenRanges(text, layout, 4, [[fox, fox + 3]], null, true);
    expect(show(text, hidden)).toBe('The…fox…');
  });

  it('keeps an extension at the end', () => {
    const text = graphemes('quarterly-report-final-v3.pdf');
    const layout = layoutFor(text.length, ['end']);
    const ext = keepRanges(text.join(''), [/\.[^.]+$/]);
    expect(show(text, hiddenRanges(text, layout, 9, ext, null, true))).toBe('quarterly….pdf');
  });

  it('places several ellipses', () => {
    const text = graphemes('0123456789abcdefghij');
    const layout = layoutFor(text.length, [0.25, 0.75]);
    expect(show(text, hiddenRanges(text, layout, 8, [], null, true))).toBe('01…89ab…ij');
  });
});

describe('showSlivers', () => {
  // 0         1         2         3
  // 0123456789012345678901234567890
  // The quick brown fox jumps over
  const g = graphemes('The quick brown fox jumps over');
  const fox: Range = [16, 19];

  it('shows a sliver beside a pin, and hides as much more elsewhere', () => {
    // "The quick br…fox…over": "own " is a sliver; the cut after fox pays for it.
    const cuts = showSlivers(
      g,
      [
        [12, 16],
        [19, 26],
      ],
      [fox],
    );
    expect(show(g, cuts)).toBe('The quick brown fox…');
    expect(cuts).toEqual([[19, 30]]);
  });

  it('prefers a cut away from pins to pay', () => {
    const cuts = showSlivers(
      g,
      [
        [1, 3],
        [14, 16],
        [21, 23],
      ],
      [fox],
    );
    expect(show(g, cuts)).toBe('T… quick brown fox …s over');
  });

  it('leaves real cuts alone', () => {
    // "quick brown " is no sliver.
    const cuts: Range[] = [
      [4, 16],
      [19, 26],
    ];
    expect(showSlivers(g, cuts, [fox])).toEqual(cuts);
    // Nor is a short cut that no pin made.
    expect(showSlivers(g, [[13, 15]], [])).toEqual([[13, 15]]);
  });

  it('applies through hiddenRanges', () => {
    const layout = layoutFor(g.length, ['middle']);
    for (let kept = 0; kept < g.length; kept++) {
      for (const [s, e] of hiddenRanges(g, layout, kept, [fox], null, true)) {
        const beside = e === fox[0] || s === fox[1];
        const letters = g.slice(s, e).filter((c) => c.trim()).length;
        expect(beside && letters <= 3).toBe(false);
      }
    }
  });
});

describe('separators', () => {
  const snap = separators('/');
  const at = (text: string, start: number, end: number, options?: SeparatorOptions) => {
    const g = graphemes(text);
    const cut = separators('/', options)({ graphemes: g, start, end, position: 0.5 });
    return show(g, [[cut.start, cut.end]]);
  };

  it('cuts at path segments, keeping as much text as the plain cut', () => {
    const path = graphemes('/abc/def/ghj/klm/nop');
    const layout = layoutFor(path.length, ['middle']);
    expect(show(path, hiddenRanges(path, layout, 12, [], null, true))).toBe('/abc/d…lm/nop');
    // The tail's "lm" goes to the head, which completes "def".
    expect(show(path, hiddenRanges(path, layout, 12, [], snap, true))).toBe('/abc/def/…/nop');
    expect(show(path, hiddenRanges(path, layout, 16, [], snap, true))).toBe('/abc/def/…/klm/nop');
  });

  it('keeps one fragment, grown by what the other side gives up', () => {
    // Plain cut: /abc/de…jk/lmn
    const text = '/abc/defgh/ijk/lmn';
    expect(at(text, 7, 12)).toBe('/abc/defg…/lmn');
    expect(at(text, 7, 12, { fragment: 'tail' })).toBe('/abc/…/ijk/lmn');
    expect(at(text, 7, 12, { fragment: false })).toBe('/abc/…/lmn');
    // Too little to be worth a fragment: /abc/d…k/lmn
    expect(at(text, 6, 13)).toBe('/abc/…/lmn');
  });

  it('keeps the plain cut where no separator is in reach, as the fragment', () => {
    // The tail has nowhere to snap to. The head gives up "def", which
    // completes the last segment instead of making a second fragment.
    expect(at('/abc/defgh/ijk', 8, 12)).toBe('/abc/…/ijk');
    expect(at('abcdef/xyz', 3, 8)).toBe('abc…yz');
  });

  it('leaves separators at the cut visible', () => {
    expect(at('/abc/def/ghi', 4, 9)).toBe('/abc/…/ghi');
  });

  it('does word boundaries with a space', () => {
    const g = graphemes('The quick brown fox');
    const ctx = { graphemes: g, start: 7, end: 14, position: 0.5 };
    expect(separators(' ')(ctx)).toEqual({ start: 8, end: 15 }); // The quic… fox
    expect(separators(' ', { fragment: false })(ctx)).toEqual({ start: 4, end: 15 }); // The … fox
  });

  it('accepts a RegExp', () => {
    const g = graphemes('a.b-c');
    expect(separators(/[.-]/g)({ graphemes: g, start: 3, end: 4, position: 0.5 })).toEqual({ start: 2, end: 3 });
  });
});

describe('keepRanges', () => {
  const text = 'error 42 at 10:31, error 7 at 10:32';
  it('finds strings, regexps and offsets', () => {
    expect(keepRanges(text, ['error'])).toEqual([[0, 5]]);
    expect(keepRanges(text, [/\d+:\d+/])).toEqual([[12, 17]]);
    expect(keepRanges(text, [/\d+:\d+/g])).toEqual([
      [12, 17],
      [30, 35],
    ]);
    expect(keepRanges(text, [{ start: 3, end: 6 }, 'missing'])).toEqual([[3, 6]]);
  });

  it('maps to grapheme ranges', () => {
    const t = 'a👩‍👩‍👧bc';
    const g = graphemes(t);
    const offsets = [0];
    for (const s of g) offsets.push(offsets[offsets.length - 1]! + s.length);
    expect(toGraphemeRanges(keepRanges(t, ['b']), offsets)).toEqual([[2, 3]]);
    // A range that starts inside a cluster keeps the whole cluster.
    expect(toGraphemeRanges([[2, 4]], offsets)).toEqual([[1, 2]]);
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
    for (const max of [0, 1, 7, 63, 99]) expect(searchMax(0, 99, limit(max).fits)).toBe(max);
  });

  it('uses the hint from either side', () => {
    for (const hint of [0, 10, 40, 41, 42, 90, 99]) expect(searchMax(0, 99, limit(41).fits, hint)).toBe(41);
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
