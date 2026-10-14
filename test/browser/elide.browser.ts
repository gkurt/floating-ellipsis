import { describe, expect, it } from 'vitest';
import { server } from 'vitest/browser';
import type { Position } from '#src/cut.ts';
import type { Elide } from '#src/elide.ts';
import { FONTS, PATH, PROSE, box, content, errors, frames, inkGaps, make, rendered, shown, spacer, track, visible } from './helpers.ts';

/** Lines stay inside the content box, and there are no more of them than allowed. */
function expectFits(t: Elide, lines = t.options.lines) {
  const c = content(t.element);
  const rects = t.lineRects();
  expect(rects.length).toBeGreaterThan(0);
  expect(rects.length).toBeLessThanOrEqual(lines);
  expect(t.state.lines).toBe(rects.length);
  for (const r of rects) {
    expect(r.left).toBeGreaterThanOrEqual(c.left - 0.5);
    expect(r.right).toBeLessThanOrEqual(c.right + 0.5);
  }
}

/** Every line holding an ellipsis ends at the content box's right edge. */
function expectFlush(t: Elide) {
  const right = content(t.element).right;
  const rects = t.lineRects();
  t.ellipses.forEach((_, j) => {
    const e = t.ellipsisRect(j)!;
    const middle = e.top + e.height / 2;
    const line = rects.find((r) => middle >= r.top && middle <= r.bottom)!;
    expect(line.right).toBeCloseTo(right, 0);
  });
}

/** What shows is what the state says shows, and the hidden parts fill in the rest. */
function expectConsistent(t: Elide) {
  const { hidden, text } = t.state;
  expect(rendered(t)).toBe(visible(t));
  expect(t.ellipses).toHaveLength(hidden.length);
  expect(t.element.hasAttribute('data-truncated')).toBe(hidden.length > 0);
  let rebuilt = '';
  let at = 0;
  for (const part of hidden) {
    rebuilt += t.graphemes.slice(at, part.start).join('') + part.text;
    at = part.end;
  }
  expect(rebuilt + t.graphemes.slice(at).join('')).toBe(text);
}

/**
 * A test that fails in `engine` because of a bug found there, until it's fixed:
 * - webkit: a line can break after an inline-block inside the `nowrap` join, so
 *   drawn marks (justify: 'dots' draws them) part from the glyph after them, and
 *   filling that line wraps it. Lines holding an ellipsis are left short.
 * - firefox: letter-spacing is rounded to 1/60 px per character, so the
 *   measured fill for justify: 'spread' overshoots and is given up.
 */
const knownBug = (engine: string) => (server.browser === engine ? it.fails : it);

/** Widths from narrow to wide, applying each and re-truncating right away. */
function* sweep(t: Elide, from: number, to: number, step: number) {
  for (let w = from; w <= to; w += step) {
    t.element.style.width = `${w}px`;
    t.refresh();
    yield w;
  }
}

describe.each(FONTS)('elide in %s', (font) => {
  it('leaves text that fits alone', () => {
    const t = make(box('Short', `font:${font}`));
    expect(t.truncated).toBe(false);
    expect(t.ellipses).toHaveLength(0);
    expect(rendered(t)).toBe('Short');
    expect(t.element.hasAttribute('data-truncated')).toBe(false);
  });

  const positions: [string, Position | Position[]][] = [
    ['start', 'start'],
    ['middle', 'middle'],
    ['end', 'end'],
    ['0.3', 0.3],
    ['two ellipses', [0.33, 0.67]],
  ];

  it.each(positions)('fits one line at every width, ellipsis at %s', (_, position) => {
    const t = make(box(PROSE, `font:${font}`), { position });
    const count = Array.isArray(position) ? position.length : 1;
    let before = -1;
    for (const _w of sweep(t, 40, 520, 17)) {
      expectFits(t);
      expectConsistent(t);
      const { hidden, length } = t.state;
      expect(hidden.length).toBeLessThanOrEqual(count);
      if (position === 'end' && hidden.length > 0) expect(hidden.at(-1)!.end).toBe(length);
      if (position === 'start' && hidden.length > 0) expect(hidden[0]!.start).toBe(0);
      if (t.truncated) expectFlush(t);
      // A wider box never shows less.
      expect(shown(t)).toBeGreaterThanOrEqual(before);
      before = shown(t);
    }
  });

  knownBug('webkit').each([2, 3])('fits %i lines at every width', (lines) => {
    const t = make(box(PROSE, `font:${font}`), { lines, position: 'middle' });
    let before = -1;
    for (const _w of sweep(t, 60, 420, 23)) {
      expectFits(t, lines);
      expectConsistent(t);
      if (t.truncated) {
        expectFlush(t);
        expect(t.element.getBoundingClientRect().height).toBeLessThanOrEqual(lines * 20 + 0.5);
      }
      expect(shown(t)).toBeGreaterThanOrEqual(before);
      before = shown(t);
    }
  });

  it('balances the gaps: with justify "dots", text, marks and text are evenly spaced', () => {
    const t = make(box(PROSE, `font:${font};width:260px`), { position: 'middle' });
    for (const _w of sweep(t, 180, 340, 40)) {
      const { left, right, inner } = inkGaps(t, 0);
      expect(left).not.toBeNull();
      expect(right!).toBeCloseTo(left!, 0);
      for (const g of inner) expect(g).toBeCloseTo(left!, 0);
    }
  });

  it('balances the gaps: with justify "ellipsis", both sides match and the dots keep their rhythm', () => {
    const t = make(box(PROSE, `font:${font};width:260px`), { position: 'middle', justify: 'ellipsis', ellipsis: { shape: 'dot' } });
    const rhythms: number[] = [];
    for (const _w of sweep(t, 180, 340, 40)) {
      const { left, right, inner } = inkGaps(t, 0);
      expect(right!).toBeCloseTo(left!, 0);
      expect(left!).toBeGreaterThanOrEqual(inner[0]! - 0.5);
      rhythms.push(...inner);
    }
    for (const g of rhythms) expect(g).toBeCloseTo(rhythms[0]!, 0);
  });

  it('leaves the slack at the end with justify: false', () => {
    const t = make(box(PROSE, `font:${font}`), { justify: false, position: 'middle', gap: 'dots' });
    for (const _w of sweep(t, 120, 300, 30)) {
      expectFits(t);
      const { left, right } = inkGaps(t, 0);
      expect(right!).toBeCloseTo(left!, 0);
    }
  });

  knownBug('firefox')('spreads the slack as letter-spacing with justify: "spread"', () => {
    const t = make(box(PROSE, `font:${font}`), { justify: 'spread', position: 'middle' });
    for (const _w of sweep(t, 120, 300, 30)) {
      expectFits(t);
      expectFlush(t);
    }
  });

  it('keeps what it is told to', () => {
    const t = make(box(PATH, `font:${font}`), { position: 'middle', keep: /\.[^.]+$/ });
    for (const _w of sweep(t, 90, 400, 31)) {
      expectFits(t);
      expectConsistent(t);
      expect(rendered(t).endsWith('.md')).toBe(true);
      if (t.truncated) expect(t.state.kept.map((k) => k.text)).toEqual(['.md']);
    }
  });

  it('gives a pinned word in the middle of a cut an ellipsis on each side', () => {
    const t = make(box(PROSE, `font:${font};width:260px`), { position: 'middle', keep: 'boxing' });
    expectFits(t);
    expect(t.ellipses).toHaveLength(2);
    expect(rendered(t)).toContain('boxing');
  });

  it('draws marks that fit and are evenly spaced', () => {
    for (const shape of ['dot', 'bullet', 'ring', 'square'] as const) {
      const t = make(box(PROSE, `font:${font}`), { position: 'middle', ellipsis: { shape, count: 4 }, justify: 'ellipsis' });
      expectFits(t);
      const marks = t.marks(0);
      expect(marks).toHaveLength(4);
      const { inner } = inkGaps(t, 0);
      for (const g of inner) expect(g).toBeCloseTo(inner[0]!, 0);
      t.destroy();
    }
  });
});

describe('elide', () => {
  it('never splits a grapheme', () => {
    const text = 'Family 👨‍👩‍👧‍👦 flags 🇹🇷🇯🇵 accents é ñ ü and skin tones 👍🏽 again 👨‍👩‍👧‍👦 🇹🇷 é';
    const t = make(box(text, 'width:120px'), { position: 'middle' });
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|^‍|‍$/;
    for (const _w of sweep(t, 30, 400, 7)) {
      expectFits(t);
      expectConsistent(t);
      for (const run of t.element.querySelectorAll('[data-fp-text] span')) expect(run.textContent).not.toMatch(lone);
    }
  });

  it('respects padding, borders, letter-spacing, text-transform and a scrollbar', () => {
    const t = make(
      box(PROSE, 'width:220px;padding:3px 11px;border:4px solid;letter-spacing:0.07em;text-transform:uppercase;overflow-y:scroll'),
      { position: 'middle' },
    );
    for (const _w of sweep(t, 140, 400, 37)) {
      expectFits(t);
      expectConsistent(t);
    }
  });

  it('follows its element as it is resized', async () => {
    const t = make(box(PROSE), { position: 'middle' });
    const seen = errors();
    for (const width of [400, 150, 90, 260, 900]) {
      t.element.style.width = `${width}px`;
      await frames();
      expect(t.element.hasAttribute('data-truncated')).toBe(width < 800);
      expectFits(t);
      expectConsistent(t);
    }
    expect(seen.stop()).toEqual([]);
  });

  it('keeps a multi-line element at its height while it shrinks', async () => {
    const t = make(box(PROSE, 'width:300px'), { lines: 2 });
    await frames();
    const heights: number[] = [];
    const observer = new ResizeObserver(([entry]) => heights.push(entry!.contentRect.height));
    observer.observe(t.element);
    for (let w = 300; w >= 120; w -= 9) {
      t.element.style.width = `${w}px`;
      await frames(1);
    }
    await frames();
    observer.disconnect();
    expect(new Set(heights)).toEqual(new Set([40]));
  });

  it('puts off resizes far off screen until they come near', async () => {
    spacer(innerHeight * 4);
    const el = box(PROSE, 'width:300px');
    const t = make(el, { position: 'middle' });
    await frames(3);
    const cut = rendered(t);
    el.style.width = '150px';
    await frames(3);
    // Still the cut for the old width, clipped meanwhile.
    expect(rendered(t)).toBe(cut);
    expect(el.style.overflow).toBe('clip');
    el.scrollIntoView();
    await frames(3);
    expect(rendered(t)).not.toBe(cut);
    expect(el.style.overflow).toBe('');
    expectFits(t);
  });

  it('updates text and options, and reports what changed', () => {
    const changes: { shown: number[]; hidden: number[]; reset: boolean }[] = [];
    const t = make(box(PROSE), { onChange: ({ shown, hidden, reset }) => changes.push({ shown, hidden, reset }) });
    const before = visible(t);
    t.update({ position: 'start' });
    expectConsistent(t);
    expect(t.state.hidden[0]!.start).toBe(0);
    const last = changes.at(-1)!;
    expect(last.reset).toBe(false);
    // Moving the cut from the end to the start shows some graphemes and hides others.
    expect(last.shown.length).toBeGreaterThan(0);
    expect(last.hidden.length).toBeGreaterThan(0);
    expect(visible(t)).not.toBe(before);

    t.update({ text: 'Now short' });
    expect(t.truncated).toBe(false);
    expect(rendered(t)).toBe('Now short');
    expect(changes.at(-1)!.reset).toBe(true);
  });

  it('restores the element on destroy', () => {
    const el = box('');
    el.innerHTML = 'Some <b>bold</b> text that will certainly need to be cut short here';
    el.style.height = '33px';
    const nodes = Array.from(el.childNodes);
    const t = make(el, { lines: 2, title: true });
    expect(t.truncated).toBe(true);
    expect(el.title).toContain('bold');
    t.destroy();
    expect(Array.from(el.childNodes)).toEqual(nodes);
    expect(el.style.height).toBe('33px');
    expect(el.style.overflow).toBe('');
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.hasAttribute('data-truncated')).toBe(false);
  });

  it('gives screen readers the full text', () => {
    const t = make(box(PROSE), { position: 'middle' });
    expect(t.element.querySelector('[data-fp-full]')!.textContent).toBe(PROSE);
    expect(t.element.querySelector('[data-fp-text]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    ['full', PROSE],
    ['visible', null],
  ] as const)('copies %s text across an ellipsis', (copy, expected) => {
    const t = make(box(PROSE), { position: 'middle', copy });
    expect(t.truncated).toBe(true);
    const range = document.createRange();
    range.selectNodeContents(t.element.querySelector('[data-fp-text]')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    // Engines differ in whether a script's clipboard event takes data, so it gets a stand-in.
    const data = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } });
    document.dispatchEvent(event);
    getSelection()!.removeAllRanges();
    expect(event.defaultPrevented).toBe(true);
    const text = data.get('text/plain');
    if (expected) expect(text).toBe(expected);
    else
      expect(text).toBe(`${t.graphemes.slice(0, t.state.hidden[0]!.start).join('')}…${t.graphemes.slice(t.state.hidden[0]!.end).join('')}`);
  });

  it('maps between graphemes and their boxes', () => {
    const t = make(box(PROSE, 'width:240px'), { position: 'middle' });
    const part = t.state.hidden[0]!;
    const e = t.ellipsisRect(0)!;
    let left = -Infinity;
    for (let i = 0; i < t.state.length; i++) {
      const r = t.graphemeRect(i);
      if (i >= part.start && i < part.end) {
        expect(r).toBeNull();
        continue;
      }
      expect(r!.left).toBeGreaterThanOrEqual(left - 0.01);
      left = r!.left;
      if (i < part.start) expect(r!.right).toBeLessThanOrEqual(e.left + 0.5);
      else expect(r!.left).toBeGreaterThanOrEqual(e.right - 0.5);
    }
    const mark = t.ellipses[0]!.firstChild!;
    expect(t.graphemeAt(mark, 0, 'start')).toBe(part.start);
    expect(t.graphemeAt(mark, 0, 'end')).toBe(part.end);
  });

  it('finds the ellipsis under a point, gaps included', () => {
    const t = make(box(PROSE, 'width:240px'), { position: 'middle' });
    const area = t.ellipsisArea(0)!;
    const ink = t.ellipsisInk(0)!;
    expect(area.left).toBeLessThanOrEqual(ink.left);
    expect(area.right).toBeGreaterThanOrEqual(ink.right);
    expect(t.ellipsisAt(area.left + 0.5, area.top + area.height / 2)).toBe(0);
    expect(t.ellipsisAt(area.right - 0.5, area.top + area.height / 2)).toBe(0);
    expect(t.ellipsisAt(area.left - 3, area.top + area.height / 2)).toBe(-1);
    expect(t.ellipsisAt(area.left - 3, area.top + area.height / 2, 4)).toBe(0);
  });

  it('truncates a crowded table in one batch, and again when it resizes', async () => {
    const table = track(document.createElement('table'));
    table.style.cssText = `width:600px;table-layout:fixed;font:${FONTS[1]};border-collapse:collapse`;
    const cells: HTMLTableCellElement[] = [];
    for (let r = 0; r < 300; r++) {
      const row = table.insertRow();
      for (let c = 0; c < 3; c++) {
        const cell = row.insertCell();
        cell.textContent = `${r}:${c} ${PATH}`;
        cells.push(cell);
      }
    }
    document.body.append(table);
    const instances = cells.map((cell) => make(cell, { position: 'middle' }));
    const near = instances.slice(0, 30);
    for (const t of near) expectFits(t);
    table.style.width = '420px';
    await frames();
    for (const t of near) {
      expectFits(t);
      expectConsistent(t);
    }
  });
});
