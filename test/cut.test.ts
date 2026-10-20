import { describe, expect, it } from 'bun:test';
import {
  type Around,
  type Cutting,
  type KeepContext,
  type Layout,
  type Range,
  type Position,
  type Snap,
  allocationOrder,
  complement,
  estimateKept,
  estimateWrapped,
  segmentEdges,
  shortestRun,
  wholeEdges,
  widen,
  contextOf,
  keepContexts,
  graphemeClasses,
  hiddenRanges,
  islands,
  keepClasses,
  keepRanges,
  layoutFor,
  placedLayout,
  placesOf,
  positionValue,
  sameRanges,
  searchMax,
  searchSteps,
  steeredSteps,
  separators,
  showSlivers,
  type SeparatorOptions,
  subtract,
  toGraphemeRanges,
  union,
  words,
  wrapsInto,
} from '#src/cut.ts';
import { graphemes } from '#src/graphemes.ts';

/** What cuts `g` with no wholes or context, as `hiddenRanges` and `estimateKept` take it. */
const cutting = (g: readonly string[], layout: Layout, pins: readonly Range[], snap: Snap | null, trim: boolean): Cutting => ({
  graphemes: g,
  layout,
  pins,
  snap,
  trim,
  wholes: null,
  context: null,
});
const hide = (g: readonly string[], layout: Layout, k: number, pins: readonly Range[], snap: Snap | null, trim: boolean) =>
  hiddenRanges(cutting(g, layout, pins, snap, trim), k);
const estimate = (
  g: readonly string[],
  layout: Layout,
  pins: readonly Range[],
  snap: Snap | null,
  trim: boolean,
  ...rest: [ArrayLike<number>, number, number]
) => estimateKept(cutting(g, layout, pins, snap, trim), ...rest);

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

describe('places', () => {
  it('reads a share of the line or a length from its start, as far in as the ellipsis needs', () => {
    expect(placesOf(['50%'], 100, 300, 300, 20, 16)).toEqual([200]);
    expect(placesOf(['0%', '100%'], 100, 300, 300, 20, 16)).toEqual([110, 290]);
    expect(placesOf(['40px', '2em', '1px'], 100, 300, 300, 20, 16)).toEqual([110, 132, 140]);
    // Clear of a suffix, and a share alongside places is a share of the line.
    expect(placesOf(['100%', 0.5], 0, 200, 150, 20, 16)).toEqual([100, 140]);
  });

  it('gives each island but the last what fits before its place, in turn', () => {
    // Every grapheme 10 wide: 7 fit before 75, and 3 centred between 105 and 145.
    const fits = (places: number[]) => (i: number, s: number, e: number) => (e - s) * 10 <= places[i]! - (i === 0 ? 0 : places[i - 1]!);
    const one = placedLayout(20, [75], 0, 200, fits([75]));
    expect(islands(one, 7)).toEqual([[0, 7]]);
    expect(islands(one, 10)).toEqual([
      [0, 7],
      [17, 20],
    ]);
    const two = placedLayout(20, [75, 105, 145], 0, 200, fits([75, 105, 145]));
    expect(islands(two, 7)).toEqual([[0, 7]]);
    expect(islands(two, 8 + 3)[0]).toEqual([0, 7]);
    // The islands before the last (7, 3 and 4 long) never start in the one before.
    for (let k = 0; k <= 14; k++) {
      const parts = islands(two, k);
      parts.slice(1).forEach(([s], i) => expect(s).toBeGreaterThanOrEqual(parts[i]![1]));
    }
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
    const hidden = hide(g, layout, 12, [], null, true);
    expect(show(g, hidden)).toBe('Hello…world');
    expect(show(g, hide(g, layout, 12, [], null, false))).toBe('Hello … world');
  });

  it('ignores a snap that leaves nothing to hide', () => {
    const empty = () => ({ start: 100, end: 0 });
    const layout = layoutFor(g.length, ['middle']);
    expect(hide(g, layout, 6, [], empty, false)).toEqual(hide(g, layout, 6, [], null, false));
  });

  it('keeps pinned parts, splitting the cut around them', () => {
    const text = graphemes('The quick brown fox jumps over the lazy dog');
    const layout = layoutFor(text.length, ['end']);
    const fox = text.join('').indexOf('fox');
    const hidden = hide(text, layout, 4, [[fox, fox + 3]], null, true);
    expect(show(text, hidden)).toBe('The…fox…');
  });

  it('keeps an extension at the end', () => {
    const text = graphemes('quarterly-report-final-v3.pdf');
    const layout = layoutFor(text.length, ['end']);
    const ext = keepRanges(text.join(''), [/\.[^.]+$/]);
    expect(show(text, hide(text, layout, 9, ext, null, true))).toBe('quarterly….pdf');
  });

  it('places several ellipses', () => {
    const text = graphemes('0123456789abcdefghij');
    const layout = layoutFor(text.length, [0.25, 0.75]);
    expect(show(text, hide(text, layout, 8, [], null, true))).toBe('01…89ab…ij');
  });
});

describe('wholes', () => {
  const PRICE = /\$?\d[\d,.]*\d/g;
  const cut = (text: string, positions: Position[], snap: Snap | null = null) => {
    const g = graphemes(text);
    const c: Cutting = {
      ...cutting(g, layoutFor(g.length, positions), [], snap, true),
      wholes: wholeEdges(g.length, toGraphemeRanges(keepRanges(text, [PRICE]), [...g.keys(), g.length])),
    };
    return (k: number) => show(g, hiddenRanges(c, k));
  };

  it('never shows part of one', () => {
    const text = 'Total due: $12,345.67 by Friday';
    for (const positions of [['end'], ['middle'], ['start'], [0.3, 0.7]] as Position[][]) {
      const at = cut(text, positions);
      for (let k = 0; k < text.length - 1; k++) {
        const shown = at(k);
        const digits = shown.replace(/[^\d]/g, '');
        expect(digits === '' || digits === '1234567').toBe(true);
      }
    }
  });

  it('hides all of one at an end', () => {
    const at = cut('Total due: $12,345.67', ['end']);
    expect(at(14)).toBe('Total due:…');
  });

  it('slides a cut off one, hiding as much', () => {
    // A plain cut would hide "2345" from the middle of the number.
    const at = cut('alpha beta 12345678 gamma delta', ['middle']);
    expect(at(27)).toBe('alpha beta 12345678…ma delta');
  });

  it('combines with words()', () => {
    const at = cut('Paid $1,250.00 on the 3rd of March, 2026', ['middle'], words());
    const numbers = new Set(['$1,250.00', '3', '2026']);
    for (let k = 0; k < 38; k++) for (const [n] of at(k).matchAll(/\$?\d[\d,.]*\d|\$?\d/g)) expect(numbers.has(n)).toBe(true);
  });

  it('keeps touching ones apart', () => {
    const edges = wholeEdges(6, [
      [0, 2],
      [2, 4],
    ])!;
    expect([...Array(7).keys()].map((i) => edges.start(i))).toEqual([true, false, true, false, true, true, true]);
  });

  it('widens a cut that splits one, but not into a pin', () => {
    const edges = wholeEdges(10, [[2, 8]])!;
    expect(widen(10, [[4, 6]], edges, [])).toEqual([[2, 8]]);
    expect(widen(10, [[4, 6]], edges, [[2, 3]])).toEqual([[3, 8]]);
  });
});

describe('context', () => {
  const text = 'one two three LANTERN four five six seven';
  const g = graphemes(text);
  const at = text.indexOf('LANTERN');
  const lantern: Range = [at, at + 7];
  const both = (words: number): Around => ({ before: words, after: words });

  it('grows a word at a time, after and then before', () => {
    const context = contextOf(g, [[lantern, both(2)]], [lantern])!;
    expect(context.steps.map(([s, e]) => text.slice(s, e))).toEqual([' four', 'three ', ' five', 'two ']);
    expect([...context.costs]).toEqual([5, 11, 16, 20]);
  });

  it('shows before the islands do', () => {
    const c: Cutting = {
      ...cutting(g, layoutFor(g.length, ['end']), [lantern], null, true),
      context: contextOf(g, [[lantern, both(2)]], [lantern]),
    };
    const shown = (k: number) => show(g, hiddenRanges(c, k));
    expect(shown(0)).toBe('…LANTERN…');
    expect(shown(5)).toBe('…LANTERN four…');
    expect(shown(11)).toBe('…three LANTERN four…');
    expect(shown(20)).toBe('…two three LANTERN four five…');
    // Then the islands: the start, here running into the context.
    expect(shown(24)).toBe('one two three LANTERN four five…');
  });

  it('completes a word the match ends in, and merges windows', () => {
    const lan: Range = [at, at + 3];
    const four = text.indexOf('four');
    const context = contextOf(
      g,
      [
        [lan, both(1)],
        [[four, four + 4], both(1)],
      ],
      [lan, [four, four + 4]],
    )!;
    expect(context.steps.map(([s, e]) => text.slice(s, e))).toEqual(['TERN', 'three ', ' five', 'LANTERN ']);
    expect(context.costs.at(-1)).toBe(4 + 6 + 5 + 1);
  });

  it('goes with the kept part when it gives way', () => {
    expect(contextOf(g, [[lantern, both(2)]], [])).toBeNull();
  });

  it('shows as much of the next word as fits', () => {
    const c: Cutting = {
      ...cutting(g, layoutFor(g.length, ['end']), [lantern], null, true),
      context: contextOf(g, [[lantern, both(2)]], [lantern]),
    };
    const shown = (k: number) => show(g, hiddenRanges(c, k));
    expect(shown(3)).toBe('…LANTERN fo…');
    expect(shown(8)).toBe('…ee LANTERN four…');
    // Snapped to words, only whole words show.
    expect(show(g, hiddenRanges({ ...c, snap: words() }, 3))).toBe('…LANTERN…');
  });

  it('takes a whole entire, once the other side has had its words', () => {
    const two = text.indexOf('two');
    const wholes = wholeEdges(g.length, [[two, two + 'two three'.length]]);
    const context = contextOf(g, [[lantern, both(Infinity)]], [lantern], wholes)!;
    expect(context.steps.map(([s, e]) => text.slice(s, e))).toEqual([' four', ' five', ' six', ' seven', 'two three ', 'one ']);
    expect([...context.entire]).toEqual([0, 0, 0, 0, 1, 0]);
    const c: Cutting = { ...cutting(g, layoutFor(g.length, ['end']), [lantern], null, true), wholes, context };
    // Room short of the whole goes unused rather than to part of it.
    expect(show(g, hiddenRanges(c, context.costs[3]! + 4))).toBe('…LANTERN four five six seven');
  });

  it('grows on one side only', () => {
    const after = contextOf(g, [[lantern, { before: 0, after: Infinity }]], [lantern])!;
    expect(after.steps.map(([s, e]) => text.slice(s, e))).toEqual([' four', ' five', ' six', ' seven']);
    const before = contextOf(g, [[lantern, { before: 2, after: 0 }]], [lantern])!;
    expect(before.steps.map(([s, e]) => text.slice(s, e))).toEqual(['three ', 'two ']);
  });

  it('reads a number as both sides, and an object side by side', () => {
    const words = (context: KeepContext) => keepContexts(text, [{ match: 'LANTERN', context }]).map(([, around]) => around);
    expect(words(2)).toEqual([both(2)]);
    expect(words({ after: 3 })).toEqual([{ before: 0, after: 3 }]);
    expect(words({ before: 0 })).toEqual([]);
    expect(words(0)).toEqual([]);
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

  it("keeps a sliver that's the only cut", () => {
    // "The quick bro…fox jumps over": no other cut could pay for "wn ", and
    // showing it would leave nothing truncated.
    expect(showSlivers(g, [[13, 16]], [fox])).toEqual([[13, 16]]);
  });

  it('applies through hiddenRanges', () => {
    const layout = layoutFor(g.length, ['middle']);
    for (let kept = 0; kept < g.length; kept++) {
      const cuts = hide(g, layout, kept, [fox], null, true);
      // A line's only cut has nowhere else to pay for a sliver.
      if (cuts.length < 2) continue;
      for (const [s, e] of cuts) {
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
    const cut = separators('/', options)({ graphemes: g, start, end, position: 0.5, min: 0, max: g.length });
    return show(g, [[cut.start, cut.end]]);
  };

  it('cuts at path segments, keeping as much text as the plain cut', () => {
    const path = graphemes('/abc/def/ghj/klm/nop');
    const layout = layoutFor(path.length, ['middle']);
    expect(show(path, hide(path, layout, 12, [], null, true))).toBe('/abc/d…lm/nop');
    // The tail's "lm" goes to the head, which completes "def".
    expect(show(path, hide(path, layout, 12, [], snap, true))).toBe('/abc/def/…/nop');
    expect(show(path, hide(path, layout, 16, [], snap, true))).toBe('/abc/def/…/klm/nop');
  });

  it('keeps one fragment, grown by what the other side gives up', () => {
    // Plain cut: /abc/de…jk/lmn
    const text = '/abc/defgh/ijk/lmn';
    expect(at(text, 7, 12)).toBe('/abc/defg…/lmn');
    expect(at(text, 7, 12, { fragment: 'tail' })).toBe('/abc/…/ijk/lmn');
    // Whole segments: "defgh" alone hides as much as the plain cut.
    expect(at(text, 7, 12, { fragment: false })).toBe('/abc/…/ijk/lmn');
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
    const ctx = { graphemes: g, start: 7, end: 14, position: 0.5, min: 0, max: g.length };
    expect(separators(' ')(ctx)).toEqual({ start: 8, end: 15 }); // The quic… fox
    expect(separators(' ', { fragment: false })(ctx)).toEqual({ start: 4, end: 15 }); // The … fox
  });

  it('accepts a RegExp', () => {
    const g = graphemes('a.b-c');
    expect(separators(/[.-]/g)({ graphemes: g, start: 3, end: 4, position: 0.5, min: 0, max: g.length })).toEqual({ start: 2, end: 3 });
  });

  it('drops the shortest run of whole segments that hides enough, leaving little room', () => {
    const path = graphemes('/Users/ada/Projects/analytical-engine/notes/2026/difference-tables.md');
    const layout = layoutFor(path.length, ['middle']);
    const whole = separators('/', { fragment: false });
    // A glyph's width each, and one for the ellipsis.
    const sums = path.map((_, i) => i).concat(path.length);
    for (let room = 20; room < path.length - 1; room++) {
      const k = estimate(path, layout, [], whole, true, sums, 1, room);
      const shown = show(path, hide(path, layout, k, [], whole, true));
      expect(graphemes(shown).length).toBeLessThanOrEqual(room);
      expect(room - graphemes(shown).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('shortestRun', () => {
  const sepOf = (text: string) => {
    const g = graphemes(text);
    return [segmentEdges((i: number) => g[i] === '/'), g.length] as const;
  };

  it('slides off a whole rather than grow', () => {
    // "abcd[efgh]ijkl": a cut of two from inside the whole goes beside it.
    const edges = wholeEdges(12, [[4, 8]])!;
    expect(shortestRun(edges, 12, 6, 8)).toEqual({ start: 8, end: 10 });
    expect(shortestRun(edges, 12, 9, 12)).toEqual({ start: 9, end: 12 });
    expect(shortestRun(edges, 12, 6, 12)).toEqual({ start: 4, end: 12 });
  });

  it('takes the shortest run that hides enough', () => {
    const [isSep, n] = sepOf('/aa/bbbbbbbb/ccc/dd/eeeeee');
    // Three to hide around "bbbbbbbb": "ccc" does it.
    expect(shortestRun(isSep, n, 6, 9)).toEqual({ start: 13, end: 16 });
  });

  it('prefers a run near the cut when another saves too little', () => {
    const [isSep, n] = sepOf('/aaaa/bbb/cccccccccccccccccccc/dd/eeee');
    // "dd" would leave no room over, but is far; "bbb" is next to the cut.
    expect(shortestRun(isSep, n, 6, 8)).toEqual({ start: 6, end: 9 });
  });

  it('stays within its bounds, and off the ends of the text', () => {
    const [isSep, n] = sepOf('/aa/bbbbbbbb/ccc/dd/eeeeee');
    expect(shortestRun(isSep, n, 6, 9, 0, 12)).toEqual({ start: 4, end: 12 });
    // Inside the last segment, a cut that doesn't reach the end goes elsewhere.
    expect(shortestRun(isSep, n, 20, 23)).toEqual({ start: 13, end: 16 });
    expect(shortestRun(isSep, n, 20, 23, 17, 26)).toBeNull();
    expect(shortestRun(isSep, n, 20, 26)).toEqual({ start: 20, end: 26 });
  });
});

describe('words', () => {
  const at = (text: string, start: number, end: number, snap = words()) => {
    const g = graphemes(text);
    const cut = snap({ graphemes: g, start, end, position: 0.5, min: 0, max: g.length });
    return show(g, [[cut.start, cut.end]]);
  };

  it('cuts whole words', () => {
    // Six to hide: "brown" is too few, "brown fox" the fewest that do.
    expect(at('The quick brown fox jumps', 7, 13)).toBe('The quick … jumps');
    expect(at('The quick brown fox jumps', 21, 25)).toBe('The quick brown fox …');
  });

  it('keeps punctuation between words visible', () => {
    expect(at('Hello, wonderful world.', 9, 15)).toBe('Hello, … world.');
    // Three to hide: "world" leaves less room over than "wonderful".
    expect(at('Hello, wonderful world.', 9, 12)).toBe('Hello, wonderful ….');
  });

  it('keeps a cut at the end or start of the text there, punctuation and all', () => {
    const text = 'The quick brown fox jumps over the lazy dog in Safari.';
    expect(at(text, 30, text.length)).toBe('The quick brown fox jumps over …');
    expect(at('“Quick brown fox', 0, 4)).toBe('… brown fox');
  });

  it('finds words in text written without spaces', () => {
    const text = '日本語の文章を省略します';
    const cut = at(text, 4, 6);
    // Whatever the dictionary says the words are, the cut is at word boundaries.
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    const bounds = new Set([...segmenter.segment(text)].flatMap((s) => [s.index, s.index + s.segment.length]));
    const [before, after] = cut.split('…');
    expect(bounds.has(before!.length)).toBe(true);
    expect(bounds.has(text.length - after!.length)).toBe(true);
  });

  it('can keep a fragment of a word, as separators do', () => {
    expect(at('The quick brown fox jumps', 6, 13, words({ fragment: 'head' }))).toBe('The quic… fox jumps');
  });
});

describe('keepClasses', () => {
  it('gives each grapheme the classes of the parts that cover it', () => {
    const text = 'a 👍🏽 b 👍🏽 c';
    const keep = [{ match: /👍🏽/gu, class: 'hit' }, { start: 0, end: 4, class: 'lead' }, 'c'] as const;
    expect(keepRanges(text, keep)).toHaveLength(4);
    const g = graphemes(text);
    const offsets = [0];
    for (const s of g) offsets.push(offsets[offsets.length - 1]! + s.length);
    const classes = graphemeClasses(keepClasses(text, keep), offsets);
    expect(classes).toEqual(['lead', 'lead', 'hit lead', null, null, null, 'hit', null, null]);
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

describe('searchSteps', () => {
  /** The values probed, and the answer, for a limit of `max`. */
  const probes = (max: number, hint?: number) => {
    const tried: number[] = [];
    const search = searchSteps(0, 99, hint);
    let step = search.next();
    while (!step.done) {
      tried.push(step.value);
      step = search.next(step.value <= max);
    }
    return { tried, answer: step.value };
  };

  it('probes what searchMax would, one at a time', () => {
    expect(probes(41, 40)).toEqual({ tried: [40, 41, 43, 42], answer: 41 });
    expect(probes(41).answer).toBe(41);
  });

  it('ends on the answer when the hint is one past it', () => {
    const { tried, answer } = probes(41, 42);
    expect(answer).toBe(41);
    expect(tried).toEqual([42, 41]);
  });
});

describe('steeredSteps', () => {
  /**
   * The values probed, and the answer, for a limit of `max`: each probe
   * leaves `max - k` units of room, which `aim` turns into an answer
   * (`null` rooms: none measured).
   */
  const probes = (max: number, first: number | null, aim: (k: number, room: number) => number, measured = true) => {
    const tried: number[] = [];
    const search = steeredSteps(0, 99, first, aim);
    let step = search.next();
    while (!step.done) {
      tried.push(step.value);
      step = search.next({ fits: step.value <= max, room: measured ? max - step.value : null });
    }
    return { tried, answer: step.value };
  };
  const exact = (k: number, room: number) => k + room;

  it('finds the largest fitting value however it aims', () => {
    const aims = [
      exact,
      (k: number, room: number) => k + 2 * room,
      (k: number, room: number) => k + Math.round(room / 3),
      () => 0,
      () => 99,
    ];
    for (const aim of aims) {
      for (const max of [0, 1, 7, 41, 98, 99]) {
        for (const first of [null, 0, 40, 42, 99]) {
          expect(probes(max, first, aim).answer).toBe(max);
          expect(probes(max, first, aim, false).answer).toBe(max);
        }
      }
    }
  });

  it('a true aim goes one past the answer, then ends on it', () => {
    expect(probes(41, 10, exact)).toEqual({ tried: [10, 42, 41], answer: 41 });
    expect(probes(41, 60, exact)).toEqual({ tried: [60, 42, 41], answer: 41 });
  });

  it('without rooms, steps out from the first probe as searchSteps does', () => {
    expect(probes(41, 40, exact, false)).toEqual({ tried: [40, 41, 43, 42], answer: 41 });
    expect(probes(41, 42, exact, false)).toEqual({ tried: [42, 41], answer: 41 });
  });
});

describe('wrapsInto', () => {
  // Every grapheme 10 wide.
  const tens = (g: readonly string[]) => g.map((_, i) => i * 10).concat(g.length * 10);
  const fits = (text: string, width: number, lines: number, hidden: Range[] = [], marks: number[] = [], breaks = false, end = 0) => {
    const g = graphemes(text);
    return wrapsInto(g, tens(g), hidden, marks, { width, lines, breaks }, end);
  };

  it('puts a word that runs past the edge on the next line, and lets spaces hang', () => {
    expect(fits('ab cd', 50, 1)).toBe(true);
    expect(fits('ab cd', 40, 1)).toBe(false);
    expect(fits('ab cd', 40, 2)).toBe(true);
    // 'ab ' is 30, but the space hangs: 'cd' is on the next line either way.
    expect(fits('ab cd', 20, 2)).toBe(true);
    expect(fits('abc de', 20, 2)).toBe(false);
  });

  it('breaks a word wider than a line anywhere', () => {
    expect(fits('abcdef', 20, 3)).toBe(true);
    expect(fits('abcdef', 20, 2)).toBe(false);
    expect(fits('x abcdef', 20, 4)).toBe(true);
  });

  it('breaks around ideographs', () => {
    expect(fits('漢字漢字', 20, 2)).toBe(true);
    expect(fits('ab漢', 20, 2)).toBe(true);
  });

  it('starts a line at a line break when told to', () => {
    expect(fits('ab\ncd', 60, 1)).toBe(true);
    expect(fits('ab\ncd', 60, 1, [], [], true)).toBe(false);
    expect(fits('ab\ncd', 60, 2, [], [], true)).toBe(true);
  });

  it('joins a mark to the words either side, and the end to the last word', () => {
    // 'ab…ef' is one word 45 wide.
    expect(fits('abcd ef', 45, 1, [[2, 5]], [5])).toBe(true);
    expect(fits('abcd ef', 44, 1, [[2, 5]], [5])).toBe(false);
    // Between spaces, '…' is a word of its own: 'ab …' on the first line, 'ef' on the next.
    expect(fits('ab cd ef', 35, 2, [[3, 5]], [5])).toBe(true);
    expect(fits('ab cd ef', 34, 2, [[3, 5]], [5])).toBe(false);
    // Spaces that hang past the edge don't start a line of their own.
    expect(fits('ab      cd', 20, 2)).toBe(true);
    expect(fits('ab cd', 50, 1, [], [], false, 5)).toBe(false);
    expect(fits('ab cd', 50, 2, [], [], false, 5)).toBe(true);
  });
});

describe('estimateWrapped', () => {
  const g = graphemes('aaaa bb cccc dd eeee');
  const sums = g.map((_, i) => i * 10).concat(g.length * 10);
  const c = cutting(g, layoutFor(g.length, ['end']), [], null, true);

  it('keeps the most that wraps into the lines, each cut as wide as it shows', () => {
    // 'aaaa bb' on the first line, then 'cccc dd…' (75), its space trimmed: 'cccc dd e…' (95) doesn't fit 80.
    const wrap = { width: 80, lines: 2, breaks: false };
    expect(estimateWrapped(c, sums, (hidden) => hidden.map(() => 5), wrap, 0)).toBe(16);
    // A wider ellipsis: 'cccc…' (65).
    expect(estimateWrapped(c, sums, (hidden) => hidden.map(() => 25), wrap, 0)).toBe(13);
  });

  it('ends on a cut that wraps into the lines, and one more grapheme that does not', () => {
    const marks = (hidden: readonly Range[]) => hidden.map(() => 10);
    for (const width of [40, 50, 60, 70, 90]) {
      const wrap = { width, lines: 2, breaks: false };
      const k = estimateWrapped(c, sums, marks, wrap, 0);
      const fits = (k: number) => wrapsInto(g, sums, hiddenRanges(c, k), marks(hiddenRanges(c, k)), wrap);
      expect(fits(k)).toBe(true);
      expect(fits(k + 1)).toBe(false);
    }
  });
});

describe('estimateKept', () => {
  const g = graphemes('abcdefghij');
  const sums = g.map((_, i) => i * 10).concat(100);

  it('keeps as much as fits with a mark for each cut', () => {
    // Kept k from the start: 10k for the text, 5 for the ellipsis.
    expect(estimate(g, layoutFor(10, ['end']), [], null, true, sums, 5, 60)).toBe(5);
    expect(estimate(g, layoutFor(10, ['end']), [], null, true, sums, 5, 64.9)).toBe(5);
    expect(estimate(g, layoutFor(10, ['end']), [], null, true, sums, 5, 65)).toBe(6);
  });

  it('counts a mark for every cut, kept parts included', () => {
    // Keeping 'k' splits the cut in two: 10 per kept grapheme, 'k' and two marks.
    const long = graphemes('abcdefghijklmnopqrst');
    const pins: Range[] = [[10, 11]];
    const at = (room: number) => estimate(long, layoutFor(20, ['end']), pins, null, false, long.map((_, i) => i * 10).concat(200), 5, room);
    expect(at(60)).toBe(4);
    expect(at(69)).toBe(4);
    expect(at(70)).toBe(5);
  });
});

describe('sameRanges', () => {
  it('compares range by range', () => {
    expect(sameRanges([[1, 2]], [[1, 2]])).toBe(true);
    expect(sameRanges([[1, 2]], [[1, 3]])).toBe(false);
    expect(sameRanges([], [[1, 2]])).toBe(false);
  });
});

describe('graphemes', () => {
  it('keeps clusters together', () => {
    expect(graphemes('a👩‍👩‍👧b')).toEqual(['a', '👩‍👩‍👧', 'b']);
    expect(graphemes('é')).toHaveLength(1);
  });
});
