import { describe, expect, it } from 'vitest';
import { tooltip } from '#src/tooltip.ts';
import { PATH, PROSE, box, expectConsistent, expectFits, expectFlush, make, rendered, sweep, track } from './helpers.ts';

/**
 * The text highlighted with class `cls` in the element. A highlight beside an
 * ellipsis comes in pieces (the grapheme next to it is kept with it), which
 * this joins.
 */
const highlighted = (el: HTMLElement, cls = 'hit') => [...el.querySelectorAll(`[data-fp-text] .${cls}`)].map((e) => e.textContent).join('');

describe('highlights (classes on keep)', () => {
  it('keeps a match visible and wraps it in its class, at every width', () => {
    const t = make(box(PROSE), { position: 'middle', keep: { match: 'boxing', class: 'hit' } });
    for (const _w of sweep(t, 90, 600, 37)) {
      expectFits(t);
      expectConsistent(t);
      expect(highlighted(t.element)).toBe('boxing');
    }
  });

  it('marks the edges where a highlight goes on into the next piece', () => {
    const t = make(box(PROSE), { position: 'middle', keep: { match: 'boxing', class: 'hit' } });
    for (const _w of sweep(t, 120, 400, 23)) {
      const pieces = [...t.element.querySelectorAll('[data-fp-text] .hit')];
      expect(pieces.map((p) => p.textContent).join('')).toBe('boxing');
      // Open towards the pieces it goes on into, closed at its own ends.
      pieces.forEach((p, i) => {
        const open = (p.getAttribute('data-fp-open') ?? '').split(' ');
        expect(open.includes('start')).toBe(i > 0);
        expect(open.includes('end')).toBe(i < pieces.length - 1);
      });
    }
  });

  it('highlights text that fits too', () => {
    const t = make(box('A short line', 'width:400px'), { keep: { match: 'short', class: 'hit' } });
    expect(t.truncated).toBe(false);
    expect(highlighted(t.element)).toBe('short');
    expect(rendered(t)).toBe('A short line');
  });

  it('takes strings, global patterns and offsets, and joins classes that overlap', () => {
    const t = make(box(PATH, 'width:900px'), {
      keep: [
        { match: /a/g, class: 'a' },
        { start: 1, end: 6, class: 'users' },
        { match: 'ada', class: 'name' },
      ],
    });
    expect(t.truncated).toBe(false);
    const line = t.element.querySelector('[data-fp-text]')!;
    expect([...line.querySelectorAll('.a')].length).toBeGreaterThan(5);
    expect(highlighted(t.element, 'users')).toBe('Users');
    expect(line.querySelector('.a.name')!.textContent).toBe('a');
    expect(t.classOf(PATH.indexOf('ada'))).toBe('a name');
    expect(t.classOf(PATH.indexOf('ada') + 1)).toBe('name');
    expect(t.classOf(0)).toBeNull();
  });

  it('splits a highlight around an ellipsis, and keeps graphemes findable inside it', () => {
    const t = make(box(PATH, 'width:180px'), { position: 'middle', keep: [{ match: /analytical-engine/, class: 'hit' }, /\.md$/] });
    expect(t.truncated).toBe(true);
    // Every visible grapheme has a box, left to right on the line.
    let left = -Infinity;
    for (let i = 0; i < t.state.length; i++) {
      const r = t.graphemeRect(i);
      if (t.state.hidden.some((p) => i >= p.start && i < p.end)) continue;
      expect(r).not.toBeNull();
      expect(r!.left).toBeGreaterThanOrEqual(left - 0.01);
      left = r!.left;
    }
    // A position in a highlight's text maps back to its grapheme.
    const pieces = [...t.element.querySelectorAll<HTMLElement>('[data-fp-text] .hit')];
    const span = pieces.reduce((a, b) => (b.textContent.length > a.textContent.length ? b : a));
    const first = PATH.indexOf('analytical-engine') + 'analytical-engine'.indexOf(span.textContent);
    expect(t.graphemeAt(span.firstChild!, 2)).toBe(first + 2);
    expect(t.graphemeAt(span, 0)).toBe(first);
  });

  it('puts the class on glyphs in glyph mode', () => {
    const t = make(box(PROSE, 'width:220px'), { position: 'middle', glyphs: true, keep: { match: 'fox', class: 'hit' } });
    expect(t.truncated).toBe(true);
    const at = PROSE.indexOf('fox');
    for (let i = at; i < at + 3; i++) expect(t.glyph(i)!.className).toBe('hit');
    expect(t.glyph(0)!.className).toBe('');
  });

  it('drops the class when keep changes', () => {
    const t = make(box(PROSE), { position: 'middle', keep: { match: 'fox', class: 'hit' } });
    expect(highlighted(t.element)).toBe('fox');
    t.update({ keep: 'fox' });
    expect(t.truncated).toBe(true);
    expect(highlighted(t.element)).toBe('');
    expect(rendered(t)).toContain('fox');
  });

  it('copies highlighted text across an ellipsis as the full text', () => {
    const t = make(box(PROSE), { position: 'middle', keep: { match: /o/g, class: 'hit' } });
    expect(t.truncated).toBe(true);
    const range = document.createRange();
    range.selectNodeContents(t.element.querySelector('[data-fp-text]')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    const data = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } });
    document.dispatchEvent(event);
    getSelection()!.removeAllRanges();
    expect(data.get('text/plain')).toBe(PROSE);
  });

  // Highlights that only colour the text are judged by the glyph widths
  // like plain text; ones that set it wider mustn't be.
  it.each([
    ['colour', 'color: red; background: yellow'],
    ['bold and padded', 'font-weight: bold; padding: 0 3px'],
  ])('fits at every width with a highlight that changes %s', (_, css) => {
    const style = track(document.createElement('style'));
    style.textContent = `.hit { ${css} }`;
    document.head.append(style);
    const t = make(box(PROSE), { position: 'middle', keep: { match: /ow+/g, class: 'hit' } });
    let shown = 0;
    for (const _w of sweep(t, 160, 600, 7)) {
      expectFits(t);
      expectConsistent(t);
      if (t.truncated) expectFlush(t);
      const now = t.state.length - t.state.hidden.reduce((sum, p) => sum + p.end - p.start, 0);
      expect(now).toBeGreaterThanOrEqual(shown);
      shown = now;
    }
  });

  it("shows highlights in the tooltip's full text", () => {
    const t = make(box(PATH, 'width:200px'), { position: 'middle', keep: { match: 'engine', class: 'hit' } });
    const tips = tooltip({ reveal: 'expand' });
    tips.attach(t);
    expect(tips.show(t)).toBe(true);
    const hits = [...tips.element.querySelectorAll('.hit')].map((e) => e.textContent).join('');
    expect(hits).toBe('engine');
    tips.destroy();
  });
});
