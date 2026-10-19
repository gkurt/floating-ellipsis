import { describe, expect, it } from 'bun:test';
import { graphemes } from '#src/graphemes.ts';
import { elideText, separators, words } from '#src/text.ts';

/** Every grapheme 10 wide, like a monospace font. */
const mono = (text: string) => graphemes(text).length * 10;
const PATH = '/Users/ada/Projects/analytical-engine/notes/2026/difference-tables.md';

describe('elideText', () => {
  it('leaves text that fits alone', () => {
    expect(elideText('Short', { width: 50, measure: mono })).toEqual({
      text: 'Short',
      truncated: false,
      hidden: [],
      kept: [],
      width: 50,
      tightened: 0,
    });
  });

  it('fits the width, ellipsis anywhere', () => {
    for (const position of ['start', 'middle', 'end', 0.3] as const) {
      for (let width = 30; width < 690; width += 10) {
        const r = elideText(PATH, { width, measure: mono, position });
        expect(r.width).toBeLessThanOrEqual(width);
        expect(r.truncated).toBe(true);
        // A monospace line is filled to the last glyph.
        expect(r.width).toBeGreaterThan(width - 20);
        const [part] = r.hidden;
        expect(r.text.replace('…', part!.text)).toBe(PATH);
        if (position === 'start') expect(part!.start).toBe(0);
        if (position === 'end') expect(part!.end).toBe(graphemes(PATH).length);
      }
    }
  });

  it('puts the ellipsis at a place along the width, whatever the text', () => {
    for (const text of [PATH, 'The quick brown fox jumps over the lazy dog by the old mill', 'x'.repeat(80)]) {
      const r = elideText(text, { width: 200, measure: mono, position: '50%' });
      // The ellipsis is 10 wide: what's before it ends at 95, and it at 105.
      expect(r.text.indexOf('…')).toBe(9);
      expect(r.width).toBeLessThanOrEqual(200);
      expect(r.width).toBeGreaterThan(190);
    }
    expect(elideText(PATH, { width: 200, measure: mono, position: '60px' }).text.indexOf('…')).toBe(5);
    expect(elideText(PATH, { width: 200, font: '10px monospace', measure: mono, position: '4em' }).text.indexOf('…')).toBe(3);
  });

  it('places several ellipses', () => {
    const r = elideText(PATH, { width: 300, measure: mono, position: [0.33, 0.67] });
    expect(r.hidden).toHaveLength(2);
    expect(r.text.split('…')).toHaveLength(3);
  });

  it('keeps what it is told to', () => {
    const r = elideText(PATH, { width: 200, measure: mono, position: 'middle', keep: /\.[^.]+$/ });
    expect(r.text.endsWith('.md')).toBe(true);
    expect(r.kept.map((k) => k.text)).toEqual(['.md']);
  });

  it('snaps to separators and words', () => {
    expect(elideText(PATH, { width: 400, measure: mono, position: 'middle', snap: separators('/', { fragment: false }) }).text).toMatch(
      /\/…\//,
    );
    const prose = 'The quick brown fox jumps over the lazy dog';
    const r = elideText(prose, { width: 250, measure: mono, position: 'middle', snap: words() });
    for (const side of r.text.split('…')) for (const word of side.trim().split(' ')) expect(prose.split(' ')).toContain(word);
  });

  it('never cuts a whole', () => {
    const text = 'Invoice 2026-0412 due 14 Oct, total $12,345.67, paid by transfer';
    const numbers = /\$?\d[\d,.-]*\d/g;
    const all = new Set(text.match(numbers));
    for (const position of ['end', 'middle', 0.3] as const) {
      for (let width = 60; width < 640; width += 10) {
        const r = elideText(text, { width, measure: mono, position, whole: numbers });
        expect(r.width).toBeLessThanOrEqual(width);
        for (const [n] of r.text.matchAll(numbers)) expect(all.has(n)).toBe(true);
      }
    }
  });

  it('shows words around a kept match before the rest', () => {
    const text = 'We waited on the bridge until the light went, counting herons, arguing about the water';
    const keep = { match: 'herons', context: Infinity };
    const at = (width: number, k: typeof keep | { match: string; context: number } = keep) =>
      elideText(text, { width, measure: mono, keep: k }).text;
    expect(at(80)).toBe('…herons…');
    expect(at(180)).toBe('…herons, arguing…');
    expect(at(260)).toBe('…counting herons, arguing…');
    expect(at(400)).toBe('…went, counting herons, arguing about…');
    // Two words either side, then the rest goes to the start.
    expect(at(600, { match: 'herons', context: 2 })).toBe('We waited on the bridg…went, counting herons, arguing about…');
  });

  it('tightens text a little too long rather than cut it', () => {
    // 11 graphemes, a space among them: 112 wide in 110 takes in 2 over 13 units.
    const text = 'abcde fghij';
    const r = elideText(text, { width: 108, measure: mono, tighten: 0.2 });
    expect(r).toMatchObject({ text, truncated: false, width: 108 });
    expect(r.tightened).toBeCloseTo(2 / 13);
    expect(elideText(text, { width: 100, measure: mono, tighten: 0.2 }).truncated).toBe(true);
  });

  it('shows more of a cut set tighter, with tightenCuts', () => {
    const text = 'abcdefghijklmnopqrst';
    expect(elideText(text, { width: 105, measure: mono, tighten: 0.5 })).toMatchObject({ text: 'abcdefghi…', tightened: 0 });
    // 'abcdefghij…' is 110 wide in 105: 5 over its 11 graphemes, the ellipsis' too.
    const r = elideText(text, { width: 105, measure: mono, tighten: 0.5, tightenCuts: true });
    expect(r).toMatchObject({ text: 'abcdefghij…', truncated: true, width: 105 });
    expect(r.tightened).toBeCloseTo(5 / 11);
    // Not past the most: 'abcdefghijk…' would take 7 over 12.
    expect(elideText(text, { width: 113, measure: mono, tighten: 0.5, tightenCuts: true })).toMatchObject({
      text: 'abcdefghij…',
      tightened: 0,
    });
  });

  it('counts letter-spacing and its own ellipsis', () => {
    const r = elideText(PATH, { width: 300, measure: mono, letterSpacing: 2, ellipsis: '...' });
    expect(r.text.endsWith('...')).toBe(true);
    expect(r.width).toBe(graphemes(r.text).length * 12);
    expect(r.width).toBeLessThanOrEqual(300);
  });

  it('measures the whole result, not just its glyphs', () => {
    // A measure that kerns: every pair of graphemes is 2 narrower than the glyphs alone.
    const kerned = (text: string) => Math.max(0, graphemes(text).length * 10 - Math.max(0, graphemes(text).length - 1) * 2);
    const r = elideText(PATH, { width: 300, measure: kerned });
    expect(r.width).toBeLessThanOrEqual(300);
    expect(r.width).toBeGreaterThan(290);
  });

  it('needs a font or a measure', () => {
    expect(() => elideText(PATH, { width: 100 })).toThrow();
  });
});

describe('elideText with unicode', () => {
  const SAMPLES = [
    'Family 👨‍👩‍👧‍👦 trip ✈️ to 🇯🇵 and 🇹🇷, thumbs 👍🏽👍🏿, keycaps 1️⃣ #️⃣, hearts ❤️‍🔥 and 🧑🏻‍💻 coding all night',
    'Ångström café naïve é̂ Z̵̡͓a̶̤l̷̚g̸̦o résumé fiancée',
    'नमस्ते दुनिया क्षत्रिय श्री हिन्दी भाषा में लिखा गया एक लंबा वाक्य है',
    'ภาษาไทยเขียนโดยไม่มีช่องว่างระหว่างคำ ซึ่งทำให้การตัดคำยากมาก',
    '日本語の文章はスペースを使わずに書かれるので単語の境界が分かりにくい',
    'Bold 𝐀𝐁𝐂 script 𝒜𝒷𝒸 and hieroglyphs 𓀀𓀁 in a row',
  ];
  // Wide glyphs (emoji, ideographs) take two cells, everything else one.
  const wide = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u;
  const cells = (text: string) => graphemes(text).reduce((w, g) => w + (wide.test(g) ? 20 : 10), 0);
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  for (const text of SAMPLES) {
    it(`cuts ${text.slice(0, 12)}… between graphemes`, () => {
      const g = graphemes(text);
      const options = [
        { position: 'middle' },
        { position: 'start' },
        { position: [0.3, 0.7] },
        { position: 'middle', snap: words() },
        { position: 'end', keep: { match: g.slice(4, 6).join(''), class: 'hit' } },
        { position: 'middle', letterSpacing: 1.5, ellipsis: '...' },
      ] as const;
      for (const o of options) {
        for (let width = 40; width < cells(text); width += 13) {
          const r = elideText(text, { width, measure: cells, ...o });
          expect(r.width).toBeLessThanOrEqual(width);
          expect(r.text).not.toMatch(lone);
          // Each hidden part is whole graphemes, and they fill the cuts back in.
          let rebuilt = '';
          let at = 0;
          for (const part of r.hidden) {
            expect(part.text).toBe(g.slice(part.start, part.end).join(''));
            rebuilt += g.slice(at, part.start).join('') + part.text;
            at = part.end;
          }
          expect(rebuilt + g.slice(at).join('')).toBe(text);
          const shown = r.hidden.reduce((count, p) => count - (p.end - p.start), g.length);
          expect(graphemes(r.text).length).toBe(shown + r.hidden.length * graphemes('ellipsis' in o ? o.ellipsis : '…').length);
        }
      }
    });
  }
});
