import { describe, expect, it } from 'bun:test';
import { graphemes } from '#src/graphemes.ts';
import { elideText, separators, words } from '#src/text.ts';

/** Every grapheme 10 wide, like a monospace font. */
const mono = (text: string) => graphemes(text).length * 10;
const PATH = '/Users/ada/Projects/analytical-engine/notes/2026/difference-tables.md';

describe('elideText', () => {
  it('leaves text that fits alone', () => {
    expect(elideText('Short', { width: 50, measure: mono })).toEqual({ text: 'Short', truncated: false, hidden: [], kept: [], width: 50 });
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
