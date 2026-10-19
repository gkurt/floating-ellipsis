import { describe, expect, it } from 'vitest';
import type { Elide } from '#src/elide.ts';
import { lineRects } from '#src/geometry.ts';
import { list, split } from '#src/list.ts';
import { FONTS, box, content, expectConsistent, expectFits, make, rendered, shown, spoken, sweep } from './helpers.ts';

const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Linus Torvalds', 'Ken Thompson', 'Barbara Liskov'];
const en = new Intl.ListFormat('en', { type: 'conjunction' });
const more = (hidden: number) => `${hidden} more`;

/** The label, after any pass on its way. */
function labelEl(t: Elide): HTMLElement {
  void t.state;
  return t.element.querySelector<HTMLElement>('[data-fp-list]')!;
}

/** Give `t`'s element `width` px and fit it again now. */
function widen(t: Elide, width: number) {
  t.element.style.width = `${width}px`;
  t.refresh();
}

/** The label as it shows ('' when it doesn't), drawn or as text. */
function label(t: Elide): string {
  const el = labelEl(t);
  if (el.getClientRects().length === 0) return '';
  return el.getAttribute('data-fp-list') || el.textContent.replace('⁠', '');
}

/** What shows: the text and the label. */
function seen(t: Elide): string {
  void t.state;
  return rendered(t) + label(t);
}

/** How wide `text` is on one line in `t`'s font. */
function natural(t: Elide, text: string): number {
  const el = box(text, `font:${getComputedStyle(t.element).font};width:max-content;white-space:pre`);
  const width = el.getBoundingClientRect().width;
  el.remove();
  return width;
}

/** The label follows the text on its last line, inside the box. */
function expectLabelFits(t: Elide) {
  const el = labelEl(t).getBoundingClientRect();
  const c = content(t.element);
  const last = lineRects(t).at(-1)!;
  expect(el.right).toBeLessThanOrEqual(c.right + 0.5);
  const middle = (el.top + el.bottom) / 2;
  expect(middle).toBeGreaterThanOrEqual(last.top - 1);
  expect(middle).toBeLessThanOrEqual(last.bottom + 1);
}

describe.each(FONTS)('list in %s', (font) => {
  it('shows whole items and a label for the rest, as many as fit, at every width', () => {
    const t = make(box('', `font:${font}`), list(NAMES, { format: en, label: more }));
    let before = -1;
    for (const width of sweep(t, 30, 560, 7)) {
      expectFits(t);
      expectConsistent(t);
      expect(shown(t), `at ${width}px`).toBeGreaterThanOrEqual(before);
      before = shown(t);
      if (!t.truncated) {
        expect(label(t), `at ${width}px`).toBe('');
        continue;
      }
      // The label isn't cut: alone, it can be wider than the box.
      if (width > natural(t, `… and ${NAMES.length - 1} more`) + 1) expectLabelFits(t);
      const text = rendered(t);
      const showing = NAMES.findIndex((_, i) => text === NAMES.slice(0, i + 1).join(', ')) + 1;
      if (showing === 0) {
        // Not even the first fits whole: it's cut, and the label ends it.
        expect(NAMES[0]!.startsWith(text), `at ${width}px`).toBe(true);
        expect(label(t), `at ${width}px`).toBe(text === '' ? `${NAMES.length} more` : `… and ${NAMES.length - 1} more`);
        continue;
      }
      // The first items whole, and how many more there are, joined as the format joins a last item.
      const hidden = NAMES.length - showing;
      expect(text + label(t), `at ${width}px`).toBe(en.format([...NAMES.slice(0, showing), more(hidden)]));
      // One more item, with the label for the rest, wouldn't fit.
      const next = hidden === 1 ? en.format(NAMES) : en.format([...NAMES.slice(0, showing + 1), more(hidden - 1)]);
      expect(natural(t, next), `at ${width}px`).toBeGreaterThan(width - 1);
    }
  });

  it('grows back to the whole list once it fits', () => {
    const t = make(box('', `font:${font}`), list(NAMES, { format: en }));
    const full = natural(t, en.format(NAMES));
    widen(t, Math.ceil(full) - 30);
    expect(t.truncated).toBe(true);
    widen(t, Math.ceil(full) + 1);
    expect(t.truncated).toBe(false);
    expect(label(t)).toBe('');
  });
});

describe('list', () => {
  it('joins the label as the format joins a last item', () => {
    const t = make(box('', 'width:600px'), list(NAMES, { format: en }));
    // The items and the label are set as runs of their own, so a kerning pair across them ("r,") doesn't kern.
    const widths = [1, 2, 3].map((n) => {
      const items = NAMES.slice(0, n).join(', ');
      return natural(t, items) + natural(t, en.format([...NAMES.slice(0, n), `${NAMES.length - n} more`]).slice(items.length));
    });
    widen(t, Math.ceil(widths[0]!) + 1);
    expect(seen(t)).toBe('Ada Lovelace and 4 more');
    widen(t, Math.ceil(widths[1]!) + 1);
    expect(seen(t)).toBe('Ada Lovelace, Grace Hopper, and 3 more');
  });

  it('takes its own label and joiner', () => {
    const t = make(box('', 'width:150px'), list(NAMES, { format: en, label: (n) => `+${n}`, joiner: ' ' }));
    expect(label(t)).toMatch(/^ \+\d$/);
  });

  it('finds items in the element’s text, joining the label with its last separator', () => {
    const el = box('Ada, Grace and Linus Torvalds', 'width:600px');
    const t = make(el, list(split(/, | and /)));
    widen(t, Math.ceil(natural(t, 'Ada, Grace and 1 more')) + 1);
    expect(seen(t)).toBe('Ada, Grace and 1 more');
  });

  it('counts mentions as items', () => {
    const el = box('', 'width:600px');
    el.innerHTML = ['ada', 'grace', 'linus'].map((n) => `<span data-elide-unit>@${n}</span>`).join(', ');
    const t = make(el, list(split(', ')));
    widen(t, Math.ceil(natural(t, '@ada, 2 more')) + 2);
    expect(seen(t)).toBe('@ada, 2 more');
  });

  it('is read in full by screen readers, and the label is not', () => {
    const t = make(box('', 'width:120px'), list(NAMES, { format: en }));
    expect(t.truncated).toBe(true);
    expect(spoken(t.element)).toBe(en.format(NAMES));
    expect(labelEl(t).getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the label as generated content, which find in page and copying leave out', () => {
    const t = make(box('', 'width:120px'), list(NAMES, { format: en }));
    expect(label(t)).not.toBe('');
    expect(labelEl(t).textContent).toBe('⁠');
  });

  it('hides the label while expanded', () => {
    const t = make(box('', 'width:120px'), list(NAMES, { format: en }));
    expect(label(t)).not.toBe('');
    t.expand();
    expect(t.expanded).toBe(true);
    expect(label(t)).toBe('');
    t.collapse();
    expect(label(t)).not.toBe('');
  });

  it('switches to another list', () => {
    const t = make(box('', 'width:150px'), list(NAMES, { format: en }));
    t.update(list(['Ada', 'Grace', 'Linus', 'Ken', 'Barbara', 'Edsger', 'Margaret'], { format: en, label: (n) => `${n} others` }));
    expect(label(t)).toMatch(/ others$/);
    expectConsistent(t);
  });
});
