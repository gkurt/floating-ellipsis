import { describe, expect, it } from 'vitest';
import { graphemeRect, lineRects, markInks } from '#src/geometry.ts';
import { isVisible } from '#src/options.ts';
import { FONTS, PROSE, box, content, expectConsistent, expectFits, inkGaps, make, sweep } from './helpers.ts';

describe.each(FONTS)('ellipses in brackets, in %s', (font) => {
  it.each(['[…]', '(...)', '<…>'])('keeps %s together and sets it like a word', (ellipsis) => {
    const t = make(box(PROSE, `font:${font}`), { position: 'middle', ellipsis });
    let width: number | null = null;
    for (const w of sweep(t, 140, 420, 7)) {
      expectFits(t);
      expectConsistent(t);
      const [mark, ...others] = t.ellipsisElement.querySelectorAll('[data-fp-mark]');
      // One mark, whatever room there is: nothing goes between the brackets and the dots, nor more dots.
      expect(others, `${w}px`).toHaveLength(0);
      expect(mark!.textContent).toBe(ellipsis);
      const own = mark!.getBoundingClientRect().width;
      expect(own, `${w}px`).toBeCloseTo(width ?? own, 2);
      width = own;
      // The room goes either side of it, evenly: the line ends at the edge, or
      // the gaps are as wide as `maxGap` (or a word space, if that's wider).
      const gaps = inkGaps(t, 0);
      if (gaps.left === null || gaps.right === null) continue;
      expect(gaps.left, `${w}px`).toBeCloseTo(gaps.right, 0);
      const line = lineRects(t).at(-1)!;
      if (Math.abs(line.right - content(t.element).right) > 0.5)
        expect(gaps.left, `${w}px`).toBeGreaterThan(parseFloat(getComputedStyle(t.element).fontSize) * 0.75 - 0.5);
    }
  });

  it('leaves a word space either side, wider than the dots leave', () => {
    const plain = make(box(PROSE, `font:${font};width:300px`), { position: 'middle', justify: false, gap: 'dots' });
    const quoted = make(box(PROSE, `font:${font};width:300px`), { position: 'middle', justify: false, ellipsis: '[…]' });
    const space = (t: typeof plain) => {
      const g = inkGaps(t, 0);
      return Math.min(g.left ?? Infinity, g.right ?? Infinity);
    };
    expect(space(quoted)).toBeGreaterThan(space(plain));
  });

  it('reports its dots, not its brackets, as its marks', () => {
    const t = make(box(PROSE, `font:${font};width:300px`), { position: 'middle', ellipsis: '[…]' });
    const marks = markInks(t, 0);
    expect(marks).toHaveLength(3);
    const mark = t.ellipsisElement.querySelector('[data-fp-mark]')!.getBoundingClientRect();
    for (const m of marks) {
      expect(m.left).toBeGreaterThan(mark.left);
      expect(m.right).toBeLessThan(mark.right);
    }
  });
});

const CHINESE = '我们在桥上一直等到天黑，数着白鹭，争论河水明天早上会不会涨到第二级台阶。结果并没有。第二天中午，水位已经下降了整整一米。';
/**
 * Only ideographs, which every Chinese font sets a cell wide. (Not every
 * font sets its punctuation so: the one WebKit falls back to on Windows sets
 * '。' narrower, and the text after it is off the grid already.)
 */
const IDEOGRAPHS = CHINESE.replace(/[，。]/g, '');
const CJK_FONT = '16px/24px sans-serif';

/** How far ellipsis `j` moves the text after it: its box and its margins. */
function advanceOf(t: ReturnType<typeof make>, j: number): number {
  const el = t.ellipses[j]!;
  const cs = getComputedStyle(el);
  return el.getBoundingClientRect().width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
}

/** The column each showing grapheme's box starts in, `cell` wide from the content box's left edge, or NaN off the grid. */
function columns(t: ReturnType<typeof make>, cell: number): number[] {
  const left = content(t.element).left;
  const state = t.state;
  const out: number[] = [];
  for (let i = 0; i < state.length; i++) {
    if (!isVisible(state, i)) continue;
    const r = graphemeRect(t, i);
    if (!r) continue;
    const at = (r.left - left) / cell;
    out.push(Math.abs(at - Math.round(at)) * cell < 1 / 16 ? Math.round(at) : NaN);
  }
  return out;
}

/** An ideograph's width, as laid out. */
function cellOf(css: string): number {
  const el = box('口', `${css};width:max-content`);
  const width = el.getBoundingClientRect().width;
  el.remove();
  return width;
}

describe.each(FONTS)('drawn marks, in %s', (font) => {
  // Browsers paint a box on whole pixels, so one that isn't a whole number of them paints wider or narrower by where it lands.
  it.each(['dot', 'bullet', 'ring', 'square'] as const)('are each %s a whole number of device pixels wide and tall', (shape) => {
    const t = make(box(PROSE, `font:${font}`), { position: 'middle', ellipsis: { shape, size: '0.11em' } });
    for (const w of sweep(t, 140, 420, 7)) {
      expectFits(t);
      const marks = [...t.ellipsisElement.querySelectorAll('[data-fp-shape]')];
      expect(marks.length, `${w}px`).toBeGreaterThan(0);
      for (const mark of marks) {
        const { width, height } = mark.getBoundingClientRect();
        expect(width, `${w}px`).toBeGreaterThan(0);
        expect(width * devicePixelRatio, `${w}px`).toBeCloseTo(Math.round(width * devicePixelRatio), 1);
        expect(height * devicePixelRatio, `${w}px`).toBeCloseTo(Math.round(height * devicePixelRatio), 1);
      }
    }
  });
});

describe('ellipses on cells', () => {
  it.each([
    ['end, one line', { position: 'end', lines: 1 }, 1],
    ['middle, one line', { position: 'middle', lines: 1 }, 1],
    ['start, one line', { position: 'start', lines: 1 }, 1],
    ['middle, two lines', { position: 'middle', lines: 2 }, 2],
    ['two ellipses, two lines', { position: [0.3, 0.7], lines: 2 }, 2],
  ] as const)('keeps Chinese text in its columns: %s', (_, options, cells) => {
    for (const css of [`font:${CJK_FONT}`, `font:${CJK_FONT};letter-spacing:1px`]) {
      const cell = cellOf(css);
      const t = make(box(IDEOGRAPHS, css), { ellipsis: 'auto', ...options });
      for (const w of sweep(t, 120, 520, 13)) {
        expectFits(t);
        expectConsistent(t);
        if (!t.truncated) continue;
        expect(t.ellipsisElement.querySelectorAll('[data-fp-mark]'), `${w}px`).toHaveLength(3 * cells);
        t.ellipses.forEach((_, j) => expect(advanceOf(t, j), `${css}, ${w}px`).toBeCloseTo(cells * cell, 1));
        // Every grapheme starts on a column; after an ellipsis, as many columns on as it takes.
        const cols = columns(t, cell);
        expect(
          cols.every((c) => !Number.isNaN(c)),
          `${css}, ${w}px: ${cols.join(' ')}`,
        ).toBe(true);
        const lines = new Map<number, number[]>();
        const state = t.state;
        let k = 0;
        for (let i = 0; i < state.length; i++) {
          if (!isVisible(state, i)) continue;
          const top = Math.round(graphemeRect(t, i)!.top);
          const col = cols[k++]!;
          const on = lines.get(top) ?? [];
          // A step of 1 between neighbours, or of 1 + cells across an ellipsis.
          if (on.length > 0) expect([1, 1 + cells], `${css}, ${w}px`).toContain(col - on.at(-1)!);
          lines.set(top, [...on, col]);
        }
      }
    }
  });

  it('is spaced apart like the ideographs on a justified line', () => {
    for (const w of [250, 263, 291]) {
      const css = `font:${CJK_FONT};text-align:justify;width:${w}px`;
      // (A wider box: the first line is a full one, justified, whatever its last.)
      const plain = box(IDEOGRAPHS + IDEOGRAPHS, css);
      const range = document.createRange();
      const xs: number[] = [];
      const left = content(plain).left;
      for (let i = 0; i < 40; i++) {
        range.setStart(plain.firstChild!, i);
        range.setEnd(plain.firstChild!, i + 1);
        const r = range.getBoundingClientRect();
        if (xs.length > 0 && r.left - left < xs.at(-1)!) break;
        xs.push(r.left - left);
      }
      // An ellipsis on the first line, which is justified.
      const t = make(box(IDEOGRAPHS, css), { ellipsis: 'auto', lines: 3, position: 0.2 });
      const first = Math.round(graphemeRect(t, 0)!.top);
      const e = t.ellipsisElement.getBoundingClientRect();
      expect(e.top, `${w}px`).toBeLessThan(first + 12);
      const state = t.state;
      for (let i = 0; i < state.length; i++) {
        if (!isVisible(state, i)) continue;
        const r = graphemeRect(t, i)!;
        if (Math.round(r.top) !== first) break;
        const x = r.left - left - (content(t.element).left - left);
        expect(Math.min(...xs.map((c) => Math.abs(c - x))), `${w}px, grapheme ${i} at ${x}`).toBeLessThan(0.1);
      }
    }
  });

  it('sets the dots in the middle of the line, above where they sit in Latin text', () => {
    const mid = make(box(CHINESE, `font:${CJK_FONT};width:200px`), { ellipsis: 'auto' });
    const low = make(box(CHINESE, `font:${CJK_FONT};width:200px`), { ellipsis: '…' });
    const centre = (t: typeof mid) => {
      const r = markInks(t, 0)[0]!;
      return r.top + r.height / 2;
    };
    // Lower on the page is a larger y.
    expect(centre(low) - centre(mid)).toBeGreaterThan(16 * 0.15);
    const line = mid.element.getBoundingClientRect();
    expect(Math.abs(centre(mid) - (line.top + line.height / 2))).toBeLessThan(16 * 0.2);
  });

  it("picks the marks for the text: 'auto' is '…' for other text, and follows new text", () => {
    const t = make(box(PROSE, `font:${CJK_FONT};width:200px`), { ellipsis: 'auto' });
    const plain = make(box(PROSE, `font:${CJK_FONT};width:200px`));
    expect(t.state.hidden).toEqual(plain.state.hidden);
    expect(t.markStyle).toEqual(plain.markStyle);
    t.update({ text: CHINESE });
    expect(t.markStyle).toMatchObject({ cells: 1, align: 'middle' });
    expect(t.ellipsisElement.querySelectorAll('[data-fp-mark]')).toHaveLength(3);
    t.update({ lines: 2 });
    expect(t.markStyle).toMatchObject({ cells: 2 });
    expect(t.ellipsisElement.querySelectorAll('[data-fp-mark]')).toHaveLength(6);
    t.update({ text: PROSE });
    expect(t.markStyle).toEqual(plain.markStyle);
    // Text set while another ellipsis is drawn is judged once 'auto' asks.
    plain.update({ text: CHINESE });
    plain.update({ ellipsis: 'auto' });
    expect(plain.markStyle).toMatchObject({ cells: 1, align: 'middle' });
  });

  it('decides text with no letters by its language', () => {
    const numbers = '2026年10月14日 09:41:07 — 1234567890 1234567890 1234567890';
    const digits = numbers.replace(/[^\d :—]/g, '');
    const t = make(box(digits, `font:${CJK_FONT};width:120px`, Object.assign(document.createElement('div'), { lang: 'zh-CN' })), {
      ellipsis: 'auto',
    });
    expect(t.markStyle).toMatchObject({ cells: 1 });
  });

  it('is spaced on its cells, whatever the gap and justify options say', () => {
    const cell = cellOf(`font:${CJK_FONT}`);
    for (const justify of ['dots', 'ellipsis', 'spread', false] as const) {
      const t = make(box(CHINESE, `font:${CJK_FONT};width:333px`), {
        position: 'middle',
        justify,
        gap: '0.5em',
        ellipsis: { shape: 'dot', cells: 2, align: 'middle' },
      });
      const marks = markInks(t, 0);
      expect(marks, String(justify)).toHaveLength(6);
      // Each dot centred in its third of a cell.
      const pitch = (2 * cell) / 6;
      marks.slice(1).forEach((m, k) => expect(m.left - marks[k]!.left, String(justify)).toBeCloseTo(pitch, 1));
      expect(
        columns(t, cell).every((c) => !Number.isNaN(c)),
        String(justify),
      ).toBe(true);
    }
  });
});
