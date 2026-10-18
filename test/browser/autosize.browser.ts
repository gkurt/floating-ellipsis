import { describe, expect, it } from 'vitest';
import { autoSize } from '#src/autosize.ts';
import { define } from '#src/element.ts';
import { suffix } from '#src/suffix.ts';
import { FONTS, PROSE, box, expectConsistent, expectFits, frames, make, rendered, shown, spoken, track } from './helpers.ts';

/** A parent `width` px wide, on the page until the test ends. */
function parent(width: number, css = ''): HTMLDivElement {
  const el = track(document.createElement('div'));
  el.style.cssText = `width:${width}px;${css}`;
  document.body.append(el);
  return el;
}

/** How wide `html` is on one line in `font`. */
function natural(html: string, font: string): number {
  const el = box('', `font:${font};width:max-content;white-space:nowrap`);
  el.innerHTML = html;
  const width = el.getBoundingClientRect().width;
  el.remove();
  return width;
}

/** The element's width (none of them has padding or borders), unrounded. */
const widthOf = (el: HTMLElement): number => el.getBoundingClientRect().width;

const expectWidth = (el: HTMLElement, width: number, message?: string) => expect(Math.abs(widthOf(el) - width), message).toBeLessThan(1);

/** Elements whose width comes from their content: [name, the parent's css, the element's css]. */
const CONTEXTS: [string, string, string][] = [
  ['inline-block', '', 'display:inline-block;width:auto;max-width:100%'],
  ['float', 'display:flow-root', 'float:left;width:auto;max-width:100%'],
  ['flex item', 'display:flex', 'flex:0 1 auto;min-width:0;width:auto'],
  ['grid item in a max-content track', 'display:grid;grid-template-columns:minmax(0,max-content)', 'width:auto;min-width:0'],
  ['absolutely positioned', 'position:relative;height:60px', 'position:absolute;left:0;width:auto;max-width:100%'],
];

describe.each(FONTS)('autoSize in %s', (font) => {
  describe.each(CONTEXTS)('%s', (_, parentCss, css) => {
    it.each([1, 2])('takes the width the full text would, shrinking and growing again, on %i lines', async (lines) => {
      const room = parent(500, parentCss);
      const t = make(box(PROSE, `font:${font};${css}`, room), { lines, autoSize: autoSize() });
      const full = natural(PROSE, font);
      const seen = new Map<number, number>();
      for (const width of [500, 160, 90, 300, 160, 500, 1600, 90, 500]) {
        room.style.width = `${width}px`;
        await frames(3);
        expectWidth(t.element, Math.min(full, width), `at ${width}px`);
        expectFits(t);
        expectConsistent(t);
        expect(t.truncated, `at ${width}px`).toBe(full > width * lines);
        // Truncated text fills every line it may.
        if (t.truncated) expect(t.state.lines, `at ${width}px`).toBe(lines);
        // As much shows at a width whichever way it was reached.
        if (seen.has(width)) expect(shown(t), `at ${width}px`).toBe(seen.get(width));
        seen.set(width, shown(t));
      }
    });

    it('grows to fit longer text, and shrinks to fit shorter', async () => {
      const room = parent(400, parentCss);
      const t = make(box('Short', `font:${font};${css}`, room), { autoSize: autoSize() });
      await frames(3);
      expectWidth(t.element, natural('Short', font));
      t.update({ text: PROSE });
      await frames(3);
      expectWidth(t.element, 400);
      expect(t.truncated).toBe(true);
      expectFits(t);
      t.update({ text: 'Tiny' });
      await frames(3);
      expectWidth(t.element, natural('Tiny', font));
      expect(t.truncated).toBe(false);
    });
  });

  it('wraps like text that can wrap, with no width to stop it, on 2 lines', async () => {
    const room = parent(500);
    const t = make(box(PROSE, `font:${font};display:inline-block;width:auto`, room), { lines: 2, autoSize: autoSize() });
    const full = natural(PROSE, font);
    for (const width of [500, 160, 80, 300, 1600, 120, 500]) {
      room.style.width = `${width}px`;
      await frames(3);
      expectWidth(t.element, Math.min(full, width), `at ${width}px`);
      expectFits(t);
      if (t.truncated) expect(t.state.lines, `at ${width}px`).toBe(2);
    }
  });

  it('is as wide as its elements make the text', async () => {
    const html = 'A <b style="font-weight:900;letter-spacing:0.2em">bold</b> word and <code style="font:20px monospace">code</code> too';
    const room = parent(800);
    const el = box('', `font:${font};display:inline-block;width:auto;max-width:100%`, room);
    el.innerHTML = html;
    const t = make(el, { autoSize: autoSize() });
    await frames(3);
    const full = natural(html, font);
    expectWidth(el, full);
    expect(t.truncated).toBe(false);
    room.style.width = `${Math.round(full / 2)}px`;
    await frames(3);
    expect(t.truncated).toBe(true);
    room.style.width = '800px';
    await frames(3);
    expectWidth(el, full);
    expect(t.truncated).toBe(false);
  });

  it.each([
    ['always', true],
    ['truncated', false],
  ] as const)('counts a suffix that shows %s', async (show, counted) => {
    const room = parent(800);
    const badge = document.createElement('span');
    badge.id = 'badge';
    badge.textContent = ' · 12 min ago';
    const t = make(box('Short text', `font:${font};display:inline-block;width:auto;max-width:100%`, room), {
      autoSize: autoSize(),
      suffix: suffix(badge, { show }),
    });
    await frames(3);
    const text = natural('Short text', font);
    expectWidth(t.element, counted ? natural('Short text · 12 min ago', font) : text);
    expect(t.truncated).toBe(false);
    // The copy has no id to clash with.
    expect(document.querySelectorAll('#badge')).toHaveLength(1);
    // Growing the suffix grows the element.
    badge.textContent = ' · 12 minutes ago, edited';
    await frames(3);
    expectWidth(t.element, counted ? natural('Short text · 12 minutes ago, edited', font) : text);
  });
});

describe('the copy autoSize sizes with', () => {
  it('is unseen, out of reach and left out of what is said', async () => {
    const el = box('', 'display:inline-block;width:auto;max-width:200px');
    el.innerHTML = `The <a href="#x" id="link">${PROSE}</a>`;
    const t = make(el, { autoSize: autoSize() });
    await frames(2);
    const copy = el.querySelector<HTMLElement>('[data-fp-sizer]')!;
    expect(copy.inert).toBe(true);
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect(copy.getBoundingClientRect().height).toBe(0);
    expect(copy.querySelector('a')).not.toBeNull();
    expect(copy.querySelector('[id]')).toBeNull();
    expect(t.truncated).toBe(true);
    expect(rendered(t)).not.toContain(PROSE);
    expect(spoken(el)).toBe(`The ${PROSE}`);
  });

  it('goes when autoSize is turned off, or the instance destroyed', async () => {
    const room = parent(400);
    const el = box(PROSE, 'display:inline-block;width:auto;max-width:100%', room);
    const t = make(el, { autoSize: autoSize() });
    await frames(2);
    expect(el.querySelectorAll('[data-fp-sizer]')).toHaveLength(1);
    t.update({ autoSize: null });
    expect(el.querySelector('[data-fp-sizer]')).toBeNull();
    t.update({ autoSize: autoSize() });
    expect(el.querySelectorAll('[data-fp-sizer]')).toHaveLength(1);
    t.destroy();
    expect(el.querySelector('[data-fp-sizer]')).toBeNull();
    expect(el.textContent).toBe(PROSE);
  });
});

describe('<elide-text auto-size>', () => {
  it('takes the width its full text would, growing again', async () => {
    define();
    const room = parent(400);
    const el = track(document.createElement('elide-text'));
    el.setAttribute('auto-size', '');
    el.style.cssText = 'display:inline-block;max-width:100%;font:16px/20px serif';
    el.textContent = PROSE;
    room.append(el);
    await frames(3);
    const full = natural(PROSE, '16px/20px serif');
    expectWidth(el, Math.min(full, 400));
    room.style.width = '150px';
    await frames(3);
    expectWidth(el, 150);
    room.style.width = '400px';
    await frames(3);
    expectWidth(el, Math.min(full, 400));
  });
});

describe.each(FONTS)('beside an x, in %s', (font) => {
  // Where the text and an `x` before it sit, from the parent's top: elided,
  // and as plain text (overflow hidden would move an inline-block's baseline
  // to its bottom).
  const sitting = async (parentCss: string, css: string, elided: boolean) => {
    const room = parent(400, `font:${font};${parentCss}`);
    const x = document.createElement('span');
    x.textContent = 'x';
    room.append(x);
    const el = box(PROSE, `font:${font};line-height:40px;${css}${elided ? '' : ';white-space:nowrap'}`, room);
    if (elided) make(el, { autoSize: autoSize() });
    await frames(3);
    const text = document.createRange();
    text.selectNodeContents(elided ? el.querySelector('[data-fp-text]')! : el);
    const top = room.getBoundingClientRect().top;
    return { x: x.getBoundingClientRect().bottom - top, text: text.getBoundingClientRect().bottom - top };
  };

  it.each([
    ['a flex item', 'display:flex;align-items:baseline', 'width:auto;min-width:0'],
    ['an inline-block', '', 'display:inline-block;width:auto;max-width:300px'],
  ])('sits on the baseline as %s', async (_, parentCss, css) => {
    const plain = await sitting(parentCss, css, false);
    const elided = await sitting(parentCss, css, true);
    expect(elided.x).toBeCloseTo(plain.x, 0);
    expect(elided.text).toBeCloseTo(plain.text, 0);
  });
});
