import { describe, expect, it } from 'vitest';
import { server } from 'vitest/browser';
import { dateForms } from '#src/dates.ts';
import type { Elide } from '#src/elide.ts';
import { graphemeAt, graphemeRect, shortElement, shortRect } from '#src/geometry.ts';
import { glyphs } from '#src/glyphs.ts';
import type { ElideOptions } from '#src/options.ts';
import type { Shorten } from '#src/shorten.ts';
import { tooltip } from '#src/tooltip.ts';
import { FONTS, box, expectConsistent, expectFits, expectFlush, frames, make, sweep } from './helpers.ts';

const MEETING = 'Design review with Christopher Robin on Wednesday, 14 October 2026 in the big room';
const SHORTEN: Shorten[] = [
  { match: 'Christopher Robin', to: ['C. Robin', 'C. R.'] },
  { match: 'Wednesday', to: ['Wed', 'W'] },
  { match: 'October', to: 'Oct' },
  { match: ' 2026', to: '' },
];
// WebKit starts a text range's box on a whole pixel, up to a pixel before its glyph.
const slack = server.browser === 'webkit' ? 1 : 0.5;

/** The forms the part with long form `text` takes. */
const formsOf = (text: string): readonly string[] => {
  const to = SHORTEN.find((s) => 'match' in s && s.match === text)!.to;
  return typeof to === 'string' ? [to] : to;
};

/**
 * A box of MEETING as wide as it is with every part at its first form: it
 * shows them all, and isn't cut, whatever font `serif` maps to. (A little
 * more, as each form is set as its own run.)
 */
function firstForms(options: ElideOptions): Elide {
  const el = box('Design review with C. Robin on Wed, 14 Oct in the big room', 'width:max-content');
  el.style.width = `${Math.ceil(el.getBoundingClientRect().width) + 2}px`;
  el.textContent = MEETING;
  return make(el, options);
}

/** How many steps of short forms show. */
const level = (t: Elide) => t.state.short.reduce((sum, p) => sum + formsOf(p.text).indexOf(p.form) + 1, 0);

/** No cut splits a part showing short: each is shown, or hidden whole. */
function expectWhole(t: Elide) {
  for (const p of t.state.short) for (const h of t.state.hidden) expect(h.end <= p.start || h.start >= p.end).toBe(true);
  for (const p of t.state.short) expect(t.state.hidden.some((h) => h.start <= p.start && p.end <= h.end)).toBe(false);
}

describe.each(FONTS)('shorten, in %s', (font) => {
  it.each(['end', 'middle'] as const)('takes fewer steps the more room, and cuts only once all are taken, at the %s', (position) => {
    // A part dropped at the end leaves more room than `maxGap` spreads: unlimited, every cut ends flush.
    const t = make(box(MEETING, `font:${font}`), { shorten: SHORTEN, position, maxGap: null });
    let last = Infinity;
    const seen = new Set<number>();
    for (const _ of sweep(t, 60, 700, 3)) {
      expectFits(t);
      expectConsistent(t);
      expectWhole(t);
      const steps = level(t);
      if (!t.truncated) {
        expect(steps).toBeLessThanOrEqual(last);
        last = steps;
      }
      seen.add(steps);
      expect(t.element.hasAttribute('data-shortened')).toBe(steps > 0);
      if (t.truncated) {
        // Every part that shows is at its shortest.
        for (const p of t.state.short) expect([formsOf(p.text).at(-1)]).toContain(p.form);
        expectFlush(t);
      }
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it('shows the fewest steps that fit', () => {
    const t = make(box(MEETING, `font:${font};width:max-content`), { shorten: SHORTEN });
    const full = t.element.getBoundingClientRect().width;
    t.element.style.width = `${full - 1}px`;
    t.refresh();
    expect(t.truncated).toBe(false);
    expect(t.state.short.map((p) => p.form)).toEqual(['']);
  });
});

describe('shorten', () => {
  it('is never cut inside a part, even by a cut beside it', () => {
    const t = make(box(MEETING), { shorten: SHORTEN, position: [0.3, 0.7] });
    for (const _ of sweep(t, 60, 400, 2)) {
      expectFits(t);
      expectConsistent(t);
      expectWhole(t);
    }
  });

  it('marks the element, and puts the long form in the title', () => {
    const t = firstForms({ shorten: SHORTEN, title: true });
    expect(t.truncated).toBe(false);
    expect(t.state.shortened).toBe(true);
    expect(t.element.title).toBe(MEETING);
    t.element.style.width = '900px';
    t.refresh();
    expect(t.state.shortened).toBe(false);
    expect(t.element.hasAttribute('data-shortened')).toBe(false);
    expect(t.element.hasAttribute('title')).toBe(false);
  });

  it('shows every long form while expanded', () => {
    const t = make(box(MEETING, 'width:200px'), { shorten: SHORTEN, lines: 2 });
    expect(t.state.short.length).toBeGreaterThan(0);
    t.expand();
    expect(t.state.short).toEqual([]);
    expect(t.element.querySelector('[data-fp-form]')).toBeNull();
    expect(t.element.querySelector('[data-fp-text]')!.textContent).toContain('Christopher Robin');
    t.collapse();
    expect(t.state.short.length).toBeGreaterThan(0);
    expectConsistent(t);
  });

  it('copies the long form', () => {
    const t = firstForms({ shorten: SHORTEN });
    expect(t.state.shortened).toBe(true);
    const range = document.createRange();
    range.selectNodeContents(t.element.querySelector('[data-fp-text]')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    const data = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } });
    document.dispatchEvent(event);
    getSelection()!.removeAllRanges();
    expect(event.defaultPrevented).toBe(true);
    expect(data.get('text/plain')).toBe(MEETING);
  });

  it('draws a short form as generated content, with its long form hidden until found', () => {
    const t = firstForms({ shorten: SHORTEN });
    const part = t.state.short.find((p) => p.text === 'Wednesday')!;
    const el = shortElement(t, t.state.short.indexOf(part))!;
    expect(getComputedStyle(el, '::before').content).toBe(`"${part.form}"`);
    const found = el.querySelector<HTMLElement>('[data-fp-found]')!;
    expect(found.textContent).toBe('Wednesday');
    expect(found.getAttribute('hidden')).toBe('until-found');
  });

  it.each(['keep', 'expand'] as const)('shows the long form find in page found (find: %s)', async (find) => {
    const t = firstForms({ shorten: SHORTEN, find });
    const j = t.state.short.findIndex((p) => p.text === 'Wednesday');
    const found = shortElement(t, j)!.querySelector<HTMLElement>('[data-fp-found]')!;
    found.dispatchEvent(new Event('beforematch', { bubbles: true }));
    found.removeAttribute('hidden');
    await frames();
    expect(t.state.short.some((p) => p.text === 'Wednesday')).toBe(false);
    expect(t.element.querySelector('[data-fp-text]')!.textContent).toContain('Wednesday');
    if (find === 'keep') {
      expect([...t.element.querySelectorAll('[data-fp-text] [data-fp-match]')].map((e) => e.textContent).join('')).toBe('Wednesday');
      expectFits(t);
      expectConsistent(t);
    } else {
      expect(t.expanded).toBe(true);
    }
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await frames();
    expect(t.state.short.some((p) => p.text === 'Wednesday')).toBe(true);
  });

  it('maps a short form to its part', () => {
    const t = firstForms({ shorten: SHORTEN });
    const j = t.state.short.findIndex((p) => p.text === 'Wednesday');
    const part = t.state.short[j]!;
    const rect = shortRect(t, j)!;
    expect(rect.width).toBeGreaterThan(0);
    for (let i = part.start; i < part.end; i++) expect(graphemeRect(t, i)).toBeNull();
    const before = graphemeRect(t, part.start - 1)!;
    const after = graphemeRect(t, part.end)!;
    expect(before.right).toBeLessThanOrEqual(rect.left + slack);
    expect(after.left).toBeGreaterThanOrEqual(rect.right - slack);
    const el = shortElement(t, j)!;
    expect(graphemeAt(t, el, 0)).toBe(part.start);
  });

  it('reads short forms from data-elide-short', () => {
    const el = box('');
    el.innerHTML =
      'Due <b data-elide-short="Wed">Wednesday</b>, 14 <span data-elide-short="Oct">October</span> at the <a href="#">office</a>';
    el.style.width = '230px';
    const t = make(el);
    expect(t.state.text).toBe('Due Wednesday, 14 October at the office');
    expect(t.state.short.map((p) => [p.text, p.form])).toEqual([
      ['Wednesday', 'Wed'],
      ['October', 'Oct'],
    ]);
    // The short form sits in a copy of its element.
    expect(t.element.querySelector('[data-fp-text] b [data-fp-form]')).not.toBeNull();
    expectFits(t);
    expectConsistent(t);
  });

  it('shows short forms in glyph mode', () => {
    const t = make(box(MEETING), { shorten: SHORTEN, glyphs, position: 'middle' });
    for (const _ of sweep(t, 120, 600, 11)) {
      expectFits(t);
      expectConsistent(t);
      expectWhole(t);
    }
  });

  it('takes dates from long to short', () => {
    const date = dateForms(new Date(2026, 9, 14), { locale: 'en-US' });
    const t = make(box('', 'font:15px/20px sans-serif'), date);
    const seen: string[] = [];
    for (let w = 300; w >= 40; w -= 4) {
      t.element.style.width = `${w}px`;
      t.refresh();
      expectFits(t);
      expectConsistent(t);
      const form = t.state.short[0]?.form ?? t.state.text;
      if (!t.truncated && seen.at(-1) !== form) seen.push(form);
    }
    expect(seen).toEqual(['Wednesday, October 14, 2026', 'Wed, October 14, 2026', 'Wed, Oct 14, 2026', 'Oct 14, 2026', '10/14/26']);
  });

  it('opens a tooltip on text that is only shortened, growing the long forms in', () => {
    const t = firstForms({ shorten: SHORTEN });
    expect(t.truncated).toBe(false);
    const tip = tooltip({ reveal: 'grow' });
    tip.attach(t);
    expect(tip.show(t)).toBe(true);
    expect(tip.element.textContent).toContain(MEETING);
    tip.destroy();
  });
});
