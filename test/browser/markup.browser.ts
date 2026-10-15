import { describe, expect, it } from 'vitest';
import { define } from '#src/element.ts';
import type { Elide } from '#src/elide.ts';
import { isVisible } from '#src/options.ts';
import { PROSE, box, content, expectConsistent, expectFits, frames, make, rendered, spoken, sweep, track } from './helpers.ts';

const LINKED =
  'The quick brown fox <a href="#fox" id="fox-link">jumps over</a> the <code>lazy</code> dog while the <em>five boxing wizards</em> jump';
const TEXT = 'The quick brown fox jumps over the lazy dog while the five boxing wizards jump';

/** A block holding `html`. */
function marked(html: string, css = ''): HTMLDivElement {
  const el = box('', css);
  el.innerHTML = html;
  return el;
}

/** The copies of `selector` in the visible line (not in what the ellipses hide). */
const copies = (t: Elide, selector: string) =>
  [...t.element.querySelectorAll(`[data-fp-text] ${selector}`)].filter((e) => !e.closest('[data-fp-found]'));

/** The graphemes showing in `[start, end)`, joined. */
const showing = (t: Elide, start: number, end: number) =>
  t.graphemes
    .slice(start, end)
    .filter((_, i) => isVisible(t.state, start + i))
    .join('');

/** The suffix ends inside the box, on the last line. */
function expectSuffixFits(t: Elide) {
  expect(t.state.lines).toBeGreaterThan(0);
  const suffix = t.element.querySelector('[data-fp-suffix]')!.getBoundingClientRect();
  const c = content(t.element);
  const lines = t.lineRects();
  const last = lines.at(-1)!;
  expect(suffix.right).toBeLessThanOrEqual(c.right + 0.5);
  const middle = (suffix.top + suffix.bottom) / 2;
  expect(middle).toBeGreaterThanOrEqual(last.top - 1);
  expect(middle).toBeLessThanOrEqual(last.bottom + 1);
}

describe('markup', () => {
  it('reads the element’s content: whitespace collapsed, scripts left out, a break as a space', () => {
    const t = make(marked('  One <b>two</b>\n  three<br>four<script>no</script> <span><i>five</i></span>  ', 'width:600px'));
    expect(t.state.text).toBe('One two three four five');
    expect(copies(t, 'b').map((e) => e.textContent)).toEqual(['two']);
    expect(copies(t, 'span > i').map((e) => e.textContent)).toEqual(['five']);
  });

  it('copies elements around whatever part of their text shows, at every width', () => {
    const t = make(marked(LINKED), { position: 'middle' });
    const link = TEXT.indexOf('jumps over');
    const code = TEXT.indexOf('lazy');
    for (const _w of sweep(t, 60, 640, 29)) {
      expectFits(t);
      expectConsistent(t);
      expect(t.state.text).toBe(TEXT);
      expect(
        copies(t, 'a')
          .map((e) => e.textContent)
          .join(''),
      ).toBe(showing(t, link, link + 'jumps over'.length));
      expect(
        copies(t, 'code')
          .map((e) => e.textContent)
          .join(''),
      ).toBe(showing(t, code, code + 4));
      for (const a of copies(t, 'a')) {
        expect(a.getAttribute('href')).toBe('#fox');
        expect(a.hasAttribute('id')).toBe(false);
        expect(a.getAttribute('tabindex')).toBe('-1');
      }
    }
  });

  it('takes its elements from a node passed as the text', () => {
    const fragment = document.createRange().createContextualFragment('Read <a href="#a">the docs</a> first');
    const t = make(box('', 'width:600px'), { text: fragment });
    expect(t.state.text).toBe('Read the docs first');
    expect(copies(t, 'a').map((e) => e.textContent)).toEqual(['the docs']);
  });

  it('keeps what an element holds whole beside an ellipsis', () => {
    // On one line all of it; on more, up to a space, where the line can still break.
    const cases = [
      { code: 'requestAnimationFrame()', lines: 2 },
      { code: 'text-transform: capitalize', lines: 1 },
    ];
    for (const { code, lines } of cases) {
      for (const position of ['end', 'middle', 'start'] as const) {
        const t = make(marked(`Support <code>${code}</code> when measuring glyphs`), { position, lines });
        for (const _w of sweep(t, 60, 420, 7)) {
          expectFits(t);
          expectConsistent(t);
          // A piece for each stretch of it that shows, however long.
          const start = t.state.text.indexOf(code);
          let stretches = 0;
          for (let i = start; i < start + code.length; i++)
            if (isVisible(t.state, i) && (i === start || !isVisible(t.state, i - 1))) stretches++;
          expect(copies(t, 'code')).toHaveLength(stretches);
        }
      }
    }
  });

  it('copies elements around glyphs in glyph mode', () => {
    const t = make(marked(LINKED), { position: 'middle', glyphs: true });
    for (const _w of sweep(t, 80, 600, 41)) {
      expectFits(t);
      expectConsistent(t);
      for (const a of copies(t, 'a')) expect(a.querySelector('[data-fp-glyph]')).not.toBeNull();
    }
  });

  it('gives screen readers the text and its elements, as text find in page can’t see', () => {
    const t = make(marked(LINKED), { position: 'middle' });
    expect(spoken(t.element)).toBe(TEXT);
    const copy = t.element.querySelector('[data-fp-full]')!;
    expect(copy.textContent).toBe('');
    const link = copy.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('#fox');
    expect(link.hasAttribute('tabindex')).toBe(false);
  });

  it('marks the copies of a focused link, and keeps one the cut hides in sight', async () => {
    const t = make(marked('A line that runs on and on until it ends in <a href="#end">a link</a> and more', 'width:200px'));
    expect(t.truncated).toBe(true);
    expect(copies(t, 'a')).toHaveLength(0);
    const link = t.element.querySelector<HTMLElement>('[data-fp-full] a')!;
    link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await frames();
    expect(t.expanded).toBe(false);
    expect(t.state.kept.map((p) => p.text)).toContain('a link');
    expect(
      copies(t, 'a[data-fp-focus]')
        .map((e) => e.textContent)
        .join(''),
    ).toBe('a link');
    expectFits(t);
    link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await frames();
    expect(t.state.kept).toHaveLength(0);
    expect(copies(t, 'a')).toHaveLength(0);
  });

  it('expands to show a focused link the cut hides, with find: expand', async () => {
    const t = make(marked('A line that runs on and on until it ends in <a href="#end">a link</a>', 'width:160px'), { find: 'expand' });
    expect(t.truncated).toBe(true);
    expect(copies(t, 'a')).toHaveLength(0);
    const link = t.element.querySelector<HTMLElement>('[data-fp-full] a')!;
    link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(t.expanded).toBe(true);
    const shown = [...t.element.querySelectorAll('[data-fp-text] a[data-fp-focus]')];
    expect(shown.map((e) => e.textContent).join('')).toBe('a link');
    link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await frames();
    expect(t.expanded).toBe(false);
    expectFits(t);
    expectConsistent(t);
  });

  it('keeps elements in <elide-text>, and takes a slot="suffix" child', async () => {
    define();
    const el = track(document.createElement('elide-text'));
    el.style.cssText = 'font:16px/20px serif;width:220px';
    el.innerHTML = `${PROSE.slice(0, 40)} <a href="#x">${PROSE.slice(40)}</a><button slot="suffix">More</button>`;
    document.body.append(el);
    await frames();
    const t = el.instance!;
    expect(t.state.text).toBe(PROSE);
    expect(t.element.querySelector('[data-fp-suffix] button')?.textContent).toBe('More');
    expectSuffixFits(t);
    el.remove();
    expect(el.querySelector('button[slot="suffix"]')).not.toBeNull();
    expect(el.querySelector('a')).not.toBeNull();
  });
});

describe('suffix', () => {
  it('follows the text on its last line, inside the box, at every width', () => {
    for (const lines of [1, 2]) {
      const t = make(box(PROSE), { lines, suffix: 'Read more' });
      for (const _w of sweep(t, 120, 700, 23)) {
        expect(t.state.lines).toBeLessThanOrEqual(lines);
        expectConsistent(t);
        expectSuffixFits(t);
      }
    }
  });

  it('never shows less in a wider box', () => {
    const t = make(box(PROSE), { suffix: '12 min ago' });
    let before = -1;
    for (const _w of sweep(t, 120, 900, 17)) {
      const n = t.state.length - t.state.hidden.reduce((sum, p) => sum + p.end - p.start, 0);
      expect(n).toBeGreaterThanOrEqual(before);
      before = n;
    }
  });

  it('shows only while the text is truncated, with showSuffix: truncated', () => {
    const t = make(box(PROSE, 'width:200px'), { suffix: 'More', showSuffix: 'truncated' });
    const suffix = () => t.element.querySelector<HTMLElement>('[data-fp-suffix]')!;
    expect(t.truncated).toBe(true);
    expect(suffix().getClientRects().length).toBeGreaterThan(0);
    t.update({ text: 'Short' });
    expect(t.truncated).toBe(false);
    expect(suffix().getClientRects()).toHaveLength(0);
  });

  it('fits again when the suffix changes width', async () => {
    const button = document.createElement('button');
    button.textContent = 'Less';
    const t = make(box(PROSE, 'width:260px'), { lines: 3, suffix: button });
    expectSuffixFits(t);
    button.textContent = 'Read a lot more';
    await frames();
    expect(t.state.lines).toBeLessThanOrEqual(3);
    expectSuffixFits(t);
  });

  it('moves a node in, and gives it back on destroy', () => {
    const home = track(document.createElement('div'));
    const badge = document.createElement('span');
    badge.textContent = '#482';
    home.append(badge, document.createElement('i'));
    document.body.append(home);
    const t = make(box(PROSE), { suffix: badge });
    expect(t.element.contains(badge)).toBe(true);
    expectSuffixFits(t);
    t.destroy();
    expect(home.firstChild).toBe(badge);
  });

  it('leaves a suffix that is the element’s own child out of the text, and puts it back', () => {
    const el = marked(`${PROSE} <button>More</button>`);
    const button = el.querySelector('button')!;
    const t = make(el, { suffix: button });
    expect(t.state.text).toBe(PROSE);
    t.destroy();
    expect(el.lastElementChild).toBe(button);
    expect(el.textContent).toBe(`${PROSE} More`);
  });
});

describe('find in page', () => {
  /** What each ellipsis hides, as the copies find in page searches. */
  const found = (t: Elide) => t.ellipses.map((e) => e.parentElement!.querySelector<HTMLElement>('[data-fp-found]')!);

  /** As find in page does on a match in hidden text: `beforematch`, then reveal, innermost first. */
  const match = (el: HTMLElement) => {
    for (let at: HTMLElement | null = el; at; at = at.parentElement) {
      if (at.getAttribute('hidden') !== 'until-found') continue;
      at.dispatchEvent(new Event('beforematch', { bubbles: true }));
      at.removeAttribute('hidden');
    }
  };

  it('keeps the word a match starts in in sight, marked, until a press elsewhere', async () => {
    const t = make(box(PROSE, 'width:260px'), { position: 'end' });
    const word = [...found(t)[0]!.querySelectorAll<HTMLElement>('[data-fp-word]')].find((w) => w.textContent === 'sphinx')!;
    match(word);
    await frames();
    expect(t.expanded).toBe(false);
    expect(t.state.kept.map((p) => p.text)).toEqual(['sphinx']);
    expect([...t.element.querySelectorAll('[data-fp-text] [data-fp-match]')].map((e) => e.textContent).join('')).toBe('sphinx');
    expect(found(t).every((el) => el.getAttribute('hidden') === 'until-found')).toBe(true);
    expectFits(t);
    expectConsistent(t);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await frames();
    expect(t.state.kept).toHaveLength(0);
    expect(t.element.querySelector('[data-fp-match]')).toBeNull();
  });

  it('keeps what it found in one text at a time', async () => {
    const a = make(box(PROSE, 'width:260px'));
    const b = make(box(PROSE, 'width:260px'));
    const sphinx = (t: Elide) => [...found(t)[0]!.querySelectorAll<HTMLElement>('[data-fp-word]')].find((w) => w.textContent === 'sphinx')!;
    match(sphinx(a));
    await frames();
    match(sphinx(b));
    await frames();
    expect([a.state.kept.length, b.state.kept.length]).toEqual([0, 1]);
  });

  it('puts what each ellipsis hides beside it, hidden until found', () => {
    const t = make(box(PROSE), { position: [0.3, 0.7] });
    for (const _w of sweep(t, 140, 600, 37)) {
      t.state.hidden.forEach((part, j) => {
        const el = found(t)[j]!;
        expect(el.textContent).toBe(part.text);
        expect(el.getAttribute('hidden')).toBe('until-found');
      });
    }
    t.update({ find: false });
    expect(found(t).every((el) => el.getAttribute('hidden') === '')).toBe(true);
  });

  it('expands the text in place when it finds a match, until a press elsewhere, with find: expand', async () => {
    const t = make(box(PROSE), { position: 'middle', find: 'expand' });
    found(t)[0]!.dispatchEvent(new Event('beforematch', { bubbles: true }));
    expect(t.expanded).toBe(true);
    expect(t.state.expanded).toBe(true);
    expect(t.element.hasAttribute('data-fp-expanded')).toBe(true);
    const line = t.element.querySelector('[data-fp-text]')!.cloneNode(true);
    if (!(line instanceof Element)) throw new Error('No line');
    for (const e of line.querySelectorAll('[data-fp-ellipsis]')) e.remove();
    expect(line.textContent).toBe(PROSE);
    const c = content(t.element);
    expect(t.lineRects().length).toBeGreaterThan(1);
    for (const r of t.lineRects()) expect(r.right).toBeLessThanOrEqual(c.right + 0.5);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await frames();
    expect(t.expanded).toBe(false);
    expectFits(t);
    expectConsistent(t);
  });

  it('collapses the text it expanded before when it finds a match in another', () => {
    const a = make(box(PROSE), { position: 'middle', find: 'expand' });
    const b = make(box(PROSE), { position: 'middle', find: 'expand' });
    found(a)[0]!.dispatchEvent(new Event('beforematch', { bubbles: true }));
    found(b)[0]!.dispatchEvent(new Event('beforematch', { bubbles: true }));
    expect([a.expanded, b.expanded]).toEqual([false, true]);
  });

  it('stays expanded through a resize after expand(), until collapse()', async () => {
    const t = make(box(PROSE, 'width:300px'), { lines: 2, position: 'middle' });
    expect(t.truncated).toBe(true);
    const height = t.element.getBoundingClientRect().height;
    t.expand();
    expect(t.element.getBoundingClientRect().height).toBeGreaterThan(height);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    t.element.style.width = '240px';
    await frames();
    expect(t.expanded).toBe(true);
    for (const r of t.lineRects()) expect(r.right).toBeLessThanOrEqual(content(t.element).right + 0.5);
    t.collapse();
    expect(t.expanded).toBe(false);
    expectFits(t);
    expectConsistent(t);
    expect(rendered(t)).not.toBe(PROSE);
  });
});
