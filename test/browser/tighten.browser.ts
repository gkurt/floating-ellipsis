import { describe, expect, it } from 'vitest';
import { lineRects } from '#src/geometry.ts';
import { FONTS, PROSE, box, content, expectConsistent, expectFits, expectFlush, make, sweep } from './helpers.ts';

const TEXT = 'The quick brown fox jumps over';

describe.each(FONTS)('tighten, in %s', (font) => {
  /** How wide the text is set as the page sets it. */
  const natural = (text: string) => {
    const t = make(box(text, `font:${font};width:2000px`));
    const width = lineRects(t)[0]!.width;
    t.destroy();
    return width;
  };

  it('shows text a little too long whole, ending at the edge, then cuts it as usual', () => {
    const full = natural(TEXT);
    const t = make(box(TEXT, `font:${font}`), { tighten: '0.05em' });
    const line = t.element.querySelector<HTMLElement>('[data-fp-text]')!;
    let tightened = 0;
    let cut = 0;
    for (const width of sweep(t, Math.floor(full) - 40, Math.ceil(full) + 2, 1)) {
      expectFits(t);
      expectConsistent(t);
      const { truncated, tightened: by } = t.state;
      if (truncated) {
        cut++;
        expect(by).toBe(0);
        expectFlush(t);
        continue;
      }
      // (Layout may fit it a fraction of a pixel narrower than it measures.)
      if (by === 0) {
        expect(width).toBeGreaterThan(full - 1);
        expect(line.style.letterSpacing).toBe('');
        continue;
      }
      expect(width).toBeLessThan(full);
      tightened++;
      expect(by).toBeGreaterThan(0);
      expect(by).toBeLessThanOrEqual(0.05 * parseFloat(getComputedStyle(t.element).fontSize) + 1e-6);
      // As tight as it takes: the line ends at the edge.
      expect(lineRects(t)[0]!.right).toBeGreaterThan(content(t.element).right - 0.75);
    }
    expect(tightened).toBeGreaterThan(5);
    expect(cut).toBeGreaterThan(5);
  });

  // Whether the full text was measured or judged in a pass depends on the
  // pass before: neither may decide between setting it tighter and cutting it.
  it.each(['Quarterly revenue forecast', TEXT, 'Invoice 2026-0412 for $12,345.67'])('decides the same whatever came before: %s', (text) => {
    const full = natural(text);
    const t = make(box(text, `font:${font};width:${full + 1}px`), { tighten: '0.05em' });
    const now = () => (t.truncated ? 'cut' : t.state.tightened > 0 ? 'tight' : 'full');
    let cut = false;
    for (let width = full; width > full - 40; width -= 0.25) {
      t.element.style.width = `${width}px`;
      t.refresh();
      const was = now();
      if (cut) expect(was).toBe('cut');
      cut = was === 'cut';
      t.refresh();
      expect(now()).toBe(was);
    }
    expect(cut).toBe(true);
  });

  it('takes in no more than it may', () => {
    const full = natural(TEXT);
    const t = make(box(TEXT, `font:${font};width:${full - 2}px`), { tighten: 0 });
    expect(t.truncated).toBe(true);
    t.update({ tighten: 0.01 });
    expect(t.truncated).toBe(true);
    t.update({ tighten: '0.2em' });
    expect(t.truncated).toBe(false);
    expect(t.state.tightened).toBeGreaterThan(0);
  });

  it('pulls a paragraph back onto its lines', () => {
    const t = make(box(PROSE, `font:${font}`), { lines: 3, tighten: '0.04em' });
    let saved = 0;
    for (const _ of sweep(t, 160, 420, 2)) {
      expectFits(t);
      expectConsistent(t);
      if (t.state.tightened > 0) {
        saved++;
        expect(t.truncated).toBe(false);
      }
    }
    expect(saved).toBeGreaterThan(0);
  });

  it('lets go once there is room, and when cut', () => {
    const full = natural(TEXT);
    const t = make(box(TEXT, `font:${font};width:${full - 3}px`), { tighten: '0.1em' });
    const line = t.element.querySelector<HTMLElement>('[data-fp-text]')!;
    expect(t.state.tightened).toBeGreaterThan(0);
    expect(line.style.letterSpacing).not.toBe('');
    t.element.style.width = `${full + 10}px`;
    t.refresh();
    expect(t.state.tightened).toBe(0);
    expect(line.style.letterSpacing).toBe('');
    expect(line.style.wordSpacing).toBe('');
    t.element.style.width = `${full / 2}px`;
    t.refresh();
    expect(t.truncated).toBe(true);
    expect(line.style.wordSpacing).toBe('');
  });
});
