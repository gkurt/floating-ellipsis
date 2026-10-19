import { describe, expect, it } from 'bun:test';
import { graphemes, isCJK } from '#src/graphemes.ts';
import { cellsText, ellipsisText, enclosed, markCount, markStyleFor } from '#src/marks.ts';
import { DEFAULTS } from '#src/options.ts';
import { elideText } from '#src/text.ts';

describe('enclosed', () => {
  it('takes dots in matching brackets', () => {
    for (const e of ['[…]', '(…)', '<…>', '[...]', '(...)', '«…»', '（…）', '【……】']) expect(enclosed(e), e).toBe(true);
  });

  it("doesn't take anything else", () => {
    for (const e of ['…', '...', '[…', '…]', '[)', '(…]', '[x]', '[ … ]', '[]', '>…<']) expect(enclosed(e), e).toBe(false);
  });

  it('is one mark, which copies as itself', () => {
    expect(markCount('[…]')).toBe(1);
    expect(markCount('...')).toBe(3);
    expect(ellipsisText('[…]')).toBe('[…]');
  });
});

describe('isCJK', () => {
  const cjk = (text: string, lang?: string) => isCJK(graphemes(text), lang);

  it('goes by the letters most of the text is in', () => {
    expect(cjk('我们在桥上一直等到天黑')).toBe(true);
    expect(cjk('日本語の文章はスペースを使わずに書かれる')).toBe(true);
    expect(cjk('report.pdf を開く')).toBe(false);
    expect(cjk('2026年第三四半期の報告書 final')).toBe(true);
    expect(cjk('한국어 문장은 띄어쓰기를 합니다')).toBe(false);
    expect(cjk('The quick brown fox')).toBe(false);
  });

  it('goes by the language for text without letters', () => {
    expect(cjk('2026-10-14 09:41', 'zh-CN')).toBe(true);
    expect(cjk('2026-10-14 09:41', 'ja')).toBe(true);
    expect(cjk('2026-10-14 09:41', 'ko')).toBe(false);
    expect(cjk('2026-10-14 09:41')).toBe(false);
  });
});

describe("ellipsis: 'auto'", () => {
  const style = (cjk: boolean, lines: number) => markStyleFor({ ...DEFAULTS, ellipsis: 'auto', lines }, cjk);

  it('is the default for text that is neither Chinese nor Japanese', () => {
    expect(style(false, 1)).toEqual(markStyleFor(DEFAULTS));
    expect(style(false, 3)).toEqual(markStyleFor({ ...DEFAULTS, lines: 3 }));
  });

  it('is three dots in the middle of a cell on one line, six over two on more', () => {
    expect(style(true, 1)).toMatchObject({ shape: 'dot', count: 3, cells: 1, align: 'middle' });
    expect(style(true, 2)).toMatchObject({ shape: 'dot', count: 6, cells: 2, align: 'middle' });
    expect(ellipsisText(style(true, 2))).toBe('……');
  });

  it('draws three marks a cell unless told otherwise', () => {
    expect(markCount({ shape: 'dot', cells: 2 })).toBe(6);
    expect(markCount({ shape: 'dot', cells: 2, count: 4 })).toBe(4);
    expect(cellsText(2)).toHaveLength(2);
  });

  it("is the midline ellipsis for Chinese text in elideText, and '…' for any other", () => {
    const mono = (text: string) => graphemes(text).length * 10;
    expect(elideText('我们在桥上一直等到天黑', { width: 60, measure: mono, ellipsis: 'auto' }).text).toBe('我们在桥上⋯');
    expect(elideText('The quick brown fox', { width: 60, measure: mono, ellipsis: 'auto' }).text).toBe('The q…');
  });
});
