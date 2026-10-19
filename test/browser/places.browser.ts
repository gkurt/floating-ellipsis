import { describe, expect, it } from 'vitest';
import { separators } from '#src/cut.ts';
import type { Elide } from '#src/elide.ts';
import { ellipsisInk, ellipsisRect } from '#src/geometry.ts';
import type { ElideOptions } from '#src/options.ts';
import { FONTS, PATH, PROSE, box, content, expectConsistent, expectFits, expectFlush, make, rendered, shown, sweep } from './helpers.ts';

const TEXTS = [
  PATH,
  '/Users/grace/Code/compiler/src/parser/expressions.ts',
  '/var/www/ilium/milliliter/WWW/MMM/index.html',
  'Quarterly revenue forecast, final final (2), reviewed by legal.pdf',
  PROSE,
];

/** Rows of `TEXTS`, as wide as each other. */
const column = (font: string, width: number, options: ElideOptions) =>
  TEXTS.map((text) => make(box(text, `font:${font};width:${width}px`), options));

/** The middle of ellipsis `j`'s ink. */
function middleOf(t: Elide, j = 0): number {
  const ink = ellipsisInk(t, j)!;
  return (ink.left + ink.right) / 2;
}

const em = (t: Elide) => parseFloat(getComputedStyle(t.element).fontSize);

describe.each(FONTS)('a place along the line, in %s', (font) => {
  it('puts the ellipsis within a glyph of it, whatever the text', () => {
    const rows = column(font, 230, { position: '50%' });
    for (const t of rows) {
      expectFits(t);
      expectConsistent(t);
      if (!t.truncated) continue;
      expectFlush(t);
      const c = content(t.element);
      expect(Math.abs(middleOf(t) - (c.left + c.right) / 2)).toBeLessThan(em(t));
    }
    expect(rows.filter((t) => t.truncated).length).toBeGreaterThanOrEqual(4);
  });

  it('takes a length from the start of the line', () => {
    for (const position of ['80px', '5em'] as const) {
      const t = make(box(PATH, `font:${font};width:260px`), { position });
      const at = content(t.element).left + (position === '80px' ? 80 : 5 * em(t));
      expect(Math.abs(middleOf(t) - at)).toBeLessThan(em(t));
      expectFits(t);
      expectFlush(t);
    }
  });

  it('stays near its place and flush at every width, never showing less as it widens', () => {
    const t = make(box(PATH, `font:${font}`), { position: '50%' });
    let before = 0;
    for (const _ of sweep(t, 90, 420, 3)) {
      expectFits(t);
      expectConsistent(t);
      if (!t.truncated) continue;
      expectFlush(t);
      const c = content(t.element);
      expect(Math.abs(middleOf(t) - (c.left + c.right) / 2)).toBeLessThan(em(t));
      expect(shown(t)).toBeGreaterThanOrEqual(before);
      before = shown(t);
    }
  });

  it('still keeps what keep keeps, and snaps', () => {
    for (const t of column(font, 230, { position: '50%', keep: /\.[^.]+$/, snap: separators('/') })) {
      expectFits(t);
      expectConsistent(t);
      if (t.truncated && /\.[a-z]+$/.test(t.state.text)) expect(rendered(t)).toMatch(/\.[a-z]+$/);
    }
  });

  it('places several ellipses, and counts a share alongside them along the line', () => {
    for (const position of [
      ['30%', '70%'],
      [0.3, '70%'],
    ] as const) {
      for (const t of column(font, 320, { position })) {
        expectFits(t);
        expectConsistent(t);
        if (t.state.hidden.length < 2) continue;
        expectFlush(t);
        const c = content(t.element);
        const width = c.right - c.left;
        expect(Math.abs(middleOf(t, 0) - (c.left + 0.3 * width))).toBeLessThan(2 * em(t));
        expect(Math.abs(middleOf(t, 1) - (c.left + 0.7 * width))).toBeLessThan(2 * em(t));
      }
    }
  });

  it('counts as a share of the text on more than one line', () => {
    const t = make(box(`${PROSE} ${PROSE}`, `font:${font};width:220px`), { position: '50%', lines: 2 });
    expectFits(t);
    expectConsistent(t);
    expectFlush(t);
  });
});

describe('a place along the line, in monospace', () => {
  // Not exactly: the gaps either side are even from ink to ink, so the
  // ellipsis moves with the side bearings of the glyphs beside it. (And a
  // cut beside a space, which goes with it, moves it a whole glyph.)
  it('puts the ellipsis in nearly the same place in every row of paths', () => {
    const rows = column(FONTS[2]!, 230, { position: '50%' }).filter((t) => t.truncated && !/\s/.test(t.state.text));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const [first] = rows.map((t) => ellipsisRect(t)!);
    for (const t of rows) {
      const r = ellipsisRect(t)!;
      expect(Math.abs(r.left - first!.left)).toBeLessThan(1.5);
      expect(Math.abs(r.right - first!.right)).toBeLessThan(1.5);
    }
  });
});
