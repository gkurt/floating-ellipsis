import { describe, expect, it } from 'vitest';
import { onChange } from '#src/changes.ts';
import { type Position, separators, words } from '#src/cut.ts';
import type { Elide } from '#src/elide.ts';
import { ellipsisArea, ellipsisAt, ellipsisInk, ellipsisRect, graphemeAt, graphemeRect, lineRects, markInks } from '#src/geometry.ts';
import type { ElideOptions } from '#src/options.ts';
import {
  FONTS,
  PATH,
  PROSE,
  box,
  content,
  errors,
  expectConsistent,
  expectFits,
  expectFlush,
  frames,
  inkGaps,
  make,
  rendered,
  shown,
  spacer,
  spoken,
  sweep,
  track,
  visible,
} from './helpers.ts';

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

  // What cuts are judged by, without rendering them, has to hold up: kerned
  // pairs, ligatures (of three letters too), kerning turned off, and
  // whitespace that collapses.
  it.each([
    ['kerning', 'AVATAR Typography: WAVE, Tower, Yacht, LAVA AWAY, "quoted" text, 1234567890', ''],
    ['ligatures', 'office efficient affluent traffic waffle fluffy offline baffled shuffle stiff', ''],
    ['kerning off', 'AVATAR Typography: WAVE, Tower, Yacht, LAVA AWAY, "quoted" text, 1234567890', 'font-kerning:none'],
    ['collapsing spaces', '  AVATAR  Typography:\tWAVE,\nTower,   Yacht, LAVA AWAY  ', ''],
  ])('fits one line at every width, shrinking and growing, with %s', (_, text, css) => {
    const t = make(box(text, `font:${font};${css}`), { position: 'middle' });
    let before = -1;
    let widest = 0;
    for (const w of sweep(t, 40, 560, 7)) {
      expectFits(t);
      expectConsistent(t);
      expect(shown(t)).toBeGreaterThanOrEqual(before);
      before = shown(t);
      widest = w;
    }
    // Back down from the widest box tried (any wider could show more).
    for (let w = widest; w >= 40; w -= 11) {
      t.element.style.width = `${w}px`;
      t.refresh('resize');
      expectFits(t);
      expectConsistent(t);
      // A narrower box never shows more.
      expect(shown(t)).toBeLessThanOrEqual(before);
      before = shown(t);
    }
  });

  it.each([
    [2, 'wrap'],
    [3, 'wrap'],
    [3, 'balance'],
    [3, 'pretty'],
  ])('fits %i lines at every width, text-wrap %s', (lines, wrap) => {
    const t = make(box(PROSE, `font:${font};text-wrap:${wrap}`), { lines, position: 'middle' });
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

  it('spreads the slack as letter-spacing with justify: "spread"', () => {
    const t = make(box(PROSE, `font:${font}`), { justify: 'spread', position: 'middle' });
    for (const _w of sweep(t, 120, 300, 30)) {
      expectFits(t);
      expectFlush(t);
    }
  });

  it.each([
    // Narrower than "/Users/…/difference-tables.md", no whole segments fit,
    // and the cut goes inside the last one.
    ['words', PROSE, words(), /[\s,.]/u, 120],
    ['path segments', PATH, separators('/', { fragment: false }), /\//u, 300],
  ] as const)('snaps to %s at every width', (_, text, snap, boundary, from) => {
    // Whole segments can leave more room than `maxGap` takes (tested below): no limit, so lines end flush.
    const t = make(box(text, `font:${font}`), { position: 'middle', snap, maxGap: null });
    for (const _w of sweep(t, from, 520, 29)) {
      expectFits(t);
      expectConsistent(t);
      if (!t.truncated) continue;
      expectFlush(t);
      // Each cut starts and stops at a boundary (trimmed whitespace aside).
      const { graphemes } = t;
      for (const { start, end } of t.state.hidden) {
        expect(start === 0 || boundary.test(graphemes[start - 1]!) || boundary.test(graphemes[start]!)).toBe(true);
        expect(end === graphemes.length || boundary.test(graphemes[end]!) || boundary.test(graphemes[end - 1]!)).toBe(true);
      }
    }
  });

  it('never justifies a gap wider than maxGap, leaving the rest of the room at the end', () => {
    // Whole long words dropped, and a long word wrapping: both leave a lot of room.
    const long = 'Internationalization accessibility, localization and globalization considerations';
    const wrapping = 'A short intro, then pneumonoultramicroscopicsilicovolcanoconiosis, and then a few more words to finish';
    const cases = [
      { text: long, options: { position: 'middle', snap: words() } },
      { text: long, options: { position: 'end', snap: words(), justify: 'ellipsis' } },
      ...[0.1, 0.2, 0.3].map((position) => ({ text: wrapping, options: { position, lines: 2 } })),
    ] as const;
    const widest = (maxGap: number | null) => {
      let most = 0;
      for (const { text, options } of cases) {
        const t = make(box(text, `font:${font}`), { ...options, maxGap });
        for (const _w of sweep(t, 140, 420, 11)) {
          expectFits(t);
          // The gaps as planned: what justifying controls.
          for (const { left, right, inner } of t.state.gaps)
            for (const g of [left, right, ...inner]) if (g !== null) most = Math.max(most, g);
        }
        t.destroy();
      }
      return most;
    };
    const em = parseFloat(getComputedStyle(box('', `font:${font}`)).fontSize);
    expect(widest(0.75 * em)).toBeLessThanOrEqual(0.75 * em + 0.01);
    // The same widths with no limit: the cap was doing something.
    expect(widest(null)).toBeGreaterThan(0.75 * em + 1);
  });

  it.each(['dots', 'ellipsis', 'spread', false] as const)('repeats marks into the room with justify %s', (justify) => {
    // Whole words dropped leave more room than `maxGap` takes.
    const long = 'Internationalization accessibility, localization and globalization considerations';
    const cases: ElideOptions[] = [
      { position: 'end' },
      { position: 'middle' },
      { position: 'end', ellipsis: { shape: 'bullet' } },
      { position: 'end', ellipsis: '...' },
      { position: 'end', lines: 2 },
    ];
    const maxGap = 0.75 * parseFloat(getComputedStyle(box('', `font:${font}`)).fontSize);
    for (const options of cases) {
      const t = make(box(long, `font:${font}`), { ...options, snap: words(), justify, repeat: true });
      const without = make(box(long, `font:${font}`), { ...options, snap: words(), justify });
      let repeated = 0;
      for (const w of sweep(t, 140, 420, 11)) {
        without.element.style.width = `${w}px`;
        without.refresh();
        expectFits(t, options.lines);
        expectConsistent(t);
        // The cut is the same: marks only go into the room it leaves. (A
        // single '…' is drawn as dots to repeat them, a little narrower.
        // Swept, a spread line can keep a narrower width's cut.)
        if (justify === 'dots' || (options.ellipsis !== undefined && justify !== 'spread'))
          expect(t.state.hidden).toEqual(without.state.hidden);
        if (!t.truncated) continue;
        // Flush, unless the gaps around the marks are already as wide as `maxGap` lets them get.
        const capped = t.state.gaps.some((g) => [g.left, g.right].some((v) => v !== null && v >= maxGap - 0.01));
        if (justify !== false && !capped) expectFlush(t);
        t.ellipses.forEach((_, j) => {
          const marks = markInks(t, j);
          const base = markInks(without, j).length;
          expect(marks.length).toBeGreaterThanOrEqual(base);
          if (marks.length > base) repeated++;
          const { left, right, inner } = inkGaps(t, j);
          for (const g of inner) expect(g).toBeCloseTo(inner[0]!, 0);
          const step = marks[0]!.width + inner[0]!;
          if (justify === 'dots' || justify === 'ellipsis') {
            // The gaps grow by less than another mark would take.
            const at = without.state.gaps[j]!;
            for (const [g, rest] of [
              [left, at.target],
              [right, at.target],
              [inner.at(-1)!, inkGaps(without, j).inner[0] ?? null],
            ] as const)
              if (g !== null && rest !== null) expect(g - rest).toBeLessThan(step + 0.5);
          }
        });
        if (justify === false) {
          // What's left at the end is too little for another mark (and the
          // quarter pixel a line stays inside the edge, and rounding).
          const line = lineRects(t).at(-1)!;
          expect(content(t.element).right - line.right).toBeLessThan(markInks(t, 0)[0]!.width + inkGaps(t, 0).inner[0]! + 1);
        }
      }
      expect(repeated).toBeGreaterThan(0);
      // Off again, only the ellipsis' own marks are left.
      t.update({ repeat: false });
      if (t.truncated) expect(markInks(t, 0)).toHaveLength(markInks(without, 0).length);
      t.destroy();
      without.destroy();
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
      const marks = markInks(t, 0);
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

  it('shows no ellipsis once the text fits again, however closely', () => {
    const el = box('floating-ellipsis and some more', 'width:max-content');
    const natural = el.getBoundingClientRect().width;
    el.style.width = '100px';
    const t = make(el, { position: 'middle' });
    for (const extra of [0.5, 1, 4, 40]) {
      el.style.width = '100px';
      t.refresh();
      expect(t.truncated).toBe(true);
      el.style.width = `${natural + extra}px`;
      t.refresh();
      expect(t.truncated).toBe(false);
      for (const e of el.querySelectorAll('[data-fp-ellipsis]')) expect(e.getBoundingClientRect().width, `+${extra}px`).toBe(0);
    }
  });

  it('follows its element as it is resized', async () => {
    const t = make(box(PROSE), { position: 'middle' });
    const seen = errors();
    // The last width fits the text in any font.
    for (const width of [400, 150, 90, 260, 1600]) {
      t.element.style.width = `${width}px`;
      await frames();
      expect(t.element.hasAttribute('data-truncated')).toBe(width < 1600);
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

  it('breaks truncated lines one after another, and text that fits as text-wrap says', () => {
    const el = box(PROSE, 'width:250px;text-wrap:balance');
    const own = el.getAttribute('style');
    const t = make(el, { lines: 2 });
    const style = () => getComputedStyle(el).getPropertyValue('text-wrap-style') || getComputedStyle(el).getPropertyValue('text-wrap');
    expect(t.truncated).toBe(true);
    expect(style()).not.toMatch(/balance/);
    t.element.style.width = '2000px';
    t.refresh();
    expect(t.truncated).toBe(false);
    expect(style()).toMatch(/balance/);
    t.element.style.width = '250px';
    t.refresh();
    expect(t.truncated).toBe(true);
    t.expand();
    expect(style()).toMatch(/balance/);
    t.collapse();
    expect(t.truncated).toBe(true);
    t.destroy();
    expect(el.getAttribute('style')).toBe(own);
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
    const t = make(box(PROSE));
    onChange(t, ({ shown, hidden, reset }) => changes.push({ shown, hidden, reset }));
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
    expect(spoken(t.element)).toBe(PROSE);
    // As generated content, which find in page doesn't find (it would count every match twice).
    const copy = t.element.querySelector('[data-fp-full]')!;
    expect(copy.textContent).toBe('');
    expect(getComputedStyle(copy.firstElementChild!, '::before').content).toBe(`"${PROSE}"`);
    expect(t.element.querySelector('[data-fp-text]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    ['full', PROSE, 1],
    ['visible', null, 1],
    ['full', PROSE, 2],
    ['visible', null, 2],
  ] as const)('copies %s text across an ellipsis, on %i line(s)', (copy, expected, lines) => {
    const t = make(box(PROSE), { position: 'middle', copy, lines });
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
    const e = ellipsisRect(t, 0)!;
    let left = -Infinity;
    for (let i = 0; i < t.state.length; i++) {
      const r = graphemeRect(t, i);
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
    expect(graphemeAt(t, mark, 0, 'start')).toBe(part.start);
    expect(graphemeAt(t, mark, 0, 'end')).toBe(part.end);
  });

  it.each([1, 2])('maps any position in an ellipsis to what it hides, on %i line(s)', (lines) => {
    const t = make(box(PROSE), { position: 'middle', lines });
    const part = t.state.hidden[0]!;
    const nodes = [...t.ellipses[0]!.childNodes];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(graphemeAt(t, node, 0, 'start')).toBe(part.start);
      expect(graphemeAt(t, node, 0, 'end')).toBe(part.end);
    }
  });

  it('finds the ellipsis under a point, gaps included', () => {
    const t = make(box(PROSE, 'width:240px'), { position: 'middle' });
    const area = ellipsisArea(t, 0)!;
    const ink = ellipsisInk(t, 0)!;
    expect(area.left).toBeLessThanOrEqual(ink.left);
    expect(area.right).toBeGreaterThanOrEqual(ink.right);
    expect(ellipsisAt(t, area.left + 0.5, area.top + area.height / 2)).toBe(0);
    expect(ellipsisAt(t, area.right - 0.5, area.top + area.height / 2)).toBe(0);
    expect(ellipsisAt(t, area.left - 3, area.top + area.height / 2)).toBe(-1);
    expect(ellipsisAt(t, area.left - 3, area.top + area.height / 2, 4)).toBe(0);
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

describe("lines: 'fit'", () => {
  const LONG = `${PROSE} ${PROSE} ${PROSE}`;

  it.each(FONTS)('fits as many lines as max-height leaves room for, in %s', (font) => {
    const t = make(box(LONG, `font:${font};max-height:60px`), { lines: 'fit', position: 'middle' });
    let before = -1;
    for (const _w of sweep(t, 90, 600, 23)) {
      expectFits(t);
      expectConsistent(t);
      expect(t.state.lines).toBeLessThanOrEqual(3);
      if (t.truncated) {
        expect(t.state.lines).toBe(3);
        expectFlush(t);
      }
      expect(shown(t)).toBeGreaterThanOrEqual(before);
      before = shown(t);
    }
  });

  it('fits a fixed height, less padding and borders', () => {
    const t = make(box(LONG, 'box-sizing:border-box;height:66px;padding:4px 6px;border:3px solid'), { lines: 'fit' });
    expect(t.truncated).toBe(true);
    // 66 - 2 × 4 - 2 × 3 = 52px: two lines of 20px.
    expect(t.state.lines).toBe(2);
    expectFits(t);
    expectFlush(t);
  });

  it('shows all of the text when nothing caps the height', () => {
    const t = make(box(LONG), { lines: 'fit' });
    expect(t.truncated).toBe(false);
    expect(t.state.lines).toBeGreaterThan(3);
  });

  it('fits a flex item that takes the room left in a card', () => {
    const card = track(document.createElement('div'));
    card.style.cssText = `display:flex;flex-direction:column;height:130px;width:200px;font:${FONTS[0]}`;
    const title = document.createElement('div');
    title.style.height = '30px';
    card.append(title);
    document.body.append(card);
    const t = make(box(LONG, 'flex:1;min-height:0', card), { lines: 'fit' });
    expect(t.state.lines).toBe(5);
    expectFits(t);
  });

  it('follows its height as it changes', async () => {
    const t = make(box(LONG, 'height:40px'), { lines: 'fit' });
    const seen = errors();
    for (const [height, lines] of [
      [100, 5],
      [60, 3],
      [10, 1],
      [45, 2],
    ] as const) {
      t.element.style.height = `${height}px`;
      await frames();
      expect(t.state.lines, `${height}px`).toBe(lines);
      // Too low for a line, it still shows one.
      if (height >= 20) expectFits(t);
      expectConsistent(t);
    }
    expect(seen.stop()).toEqual([]);
  });

  it('shows more lines when max-height rises past the lines it shows', async () => {
    const t = make(box(LONG, 'max-height:60px'), { lines: 'fit' });
    await frames();
    expect(t.state.lines).toBe(3);
    t.element.style.maxHeight = '100px';
    await frames();
    expect(t.state.lines).toBe(5);
    expectFits(t);
    t.element.style.maxHeight = '40px';
    await frames();
    expect(t.state.lines).toBe(2);
    t.update({ lines: 2 });
    expect(t.element.querySelector('[data-fp-room]')).toBeNull();
    t.update({ lines: 'fit' });
    t.destroy();
    expect(t.element.textContent).toBe(LONG);
  });

  it('fits a height set in em, with line-height normal', () => {
    const t = make(box(LONG, 'font:16px serif;line-height:normal;max-height:5em'), { lines: 'fit' });
    expect(t.truncated).toBe(true);
    expectFits(t);
    expect(t.element.getBoundingClientRect().height).toBeLessThanOrEqual(80.5);
  });
});
