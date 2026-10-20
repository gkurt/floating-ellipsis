import { describe, expect, it } from 'vitest';
import type { Elide } from '#src/elide.ts';
import { graphemeRect } from '#src/geometry.ts';
import { FORM } from '#src/highlight.ts';
import { FONTS, box, make } from './helpers.ts';

const MEETING = 'Design review with Christopher Robin on Wednesday, 14 October 2026 in the big room';

/** Select all of `t`'s line. (`selectionchange` follows: Firefox's can take a few frames.) */
function select(t: Elide) {
  getSelection()!.selectAllChildren(t.element);
}

const painted = (el: Element) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';

describe.each(FONTS)('selection, in %s', (font) => {
  it('paints an ellipsis, its gaps and a short form it crosses, and gives back their own styles', async () => {
    // As wide as the text with the name short, up to the day: the name shows short, and the rest is truncated.
    const el = box('Design review with C. R. on Wednesday', `font:${font};width:max-content`);
    el.style.width = `${Math.ceil(el.getBoundingClientRect().width)}px`;
    el.textContent = MEETING;
    const t = make(el, { shorten: [{ match: 'Christopher Robin', to: 'C. R.' }] });
    expect(t.truncated).toBe(true);
    const ellipsis = el.querySelector<HTMLElement>('[data-fp-ellipsis]')!;
    const form = el.querySelector<HTMLElement>(`[${FORM}]`)!;
    ellipsis.style.color = 'rgb(1, 2, 3)';
    expect(painted(ellipsis)).toBe(false);

    select(t);
    await expect.poll(() => painted(ellipsis)).toBe(true);
    expect(painted(form)).toBe(true);
    const cs = getComputedStyle(ellipsis);
    // Each gap with a margin has a shadow over it.
    const gaps = [cs.marginLeft, cs.marginRight].filter((m) => parseFloat(m) > 0).length;
    expect(cs.boxShadow === 'none' ? 0 : cs.boxShadow.split(/,(?![^(]*\))/).length).toBe(gaps);

    getSelection()!.removeAllRanges();
    await expect.poll(() => painted(ellipsis)).toBe(false);
    expect(painted(form)).toBe(false);
    expect(ellipsis.style.boxShadow).toBe('');
    expect(ellipsis.style.color).toBe('rgb(1, 2, 3)');
  });

  it("paints in the page's ::selection colour", async () => {
    const style = document.createElement('style');
    style.textContent = '.picked::selection, .picked *::selection { background: rgb(10, 200, 30); }';
    document.head.append(style);
    try {
      const el = box(MEETING, `font:${font};width:220px`);
      el.classList.add('picked');
      const t = make(el, { position: 'middle' });
      select(t);
      await expect.poll(() => getComputedStyle(el.querySelector('[data-fp-ellipsis]')!).backgroundColor).toBe('rgb(10, 200, 30)');
    } finally {
      getSelection()!.removeAllRanges();
      style.remove();
    }
  });

  it('leaves an ellipsis outside the selection alone', async () => {
    const el = box(MEETING, `font:${font};width:220px`);
    const t = make(el, { position: 'end' });
    expect(t.truncated).toBe(true);
    const caret = (i: number) => {
      const r = graphemeRect(t, i)!;
      return document.caretPositionFromPoint(r.left + 1, r.top + r.height / 2)!;
    };
    const [start, end] = [caret(0), caret(3)];
    // (The library's listener was added first, so it has run when this one does.)
    const changed = new Promise((resolve) => document.addEventListener('selectionchange', resolve, { once: true }));
    getSelection()!.setBaseAndExtent(start.offsetNode, start.offset, end.offsetNode, end.offset);
    await changed;
    expect(painted(el.querySelector('[data-fp-ellipsis]')!)).toBe(false);
    getSelection()!.removeAllRanges();
  });
});
