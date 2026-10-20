/** What the browser suites share: fixtures that clean up after themselves, and layout readings. */
import { afterEach, expect, it } from 'vitest';
import { server } from 'vitest/browser';
import { type Elide, elide } from '#src/elide.ts';
import { ellipsisRect, graphemeRect, lineRects, markInks } from '#src/geometry.ts';
import { fontOf, measure } from '#src/metrics.ts';
import { type ElideOptions, isVisible } from '#src/options.ts';

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** The real mouse at `x`, `y` in the test frame's viewport, `'press'` pressing `times` times in one go (see vitest.config.ts). */
    mouse: (action: 'move' | 'down' | 'up' | 'press', x: number, y: number, times?: number) => Promise<void>;
    /** Wait for a turn with the page's one mouse and focus (`'take'`), or end it (`'give'`). */
    pointer: (action: 'take' | 'give') => Promise<void>;
    reducedMotion: (on: boolean) => Promise<void>;
    /** Layouts the page has done so far (Chromium only). */
    layouts: () => Promise<number>;
    /** Performance metrics so far, by name: counts, and durations in seconds (Chromium only). */
    metrics: () => Promise<Record<string, number>>;
    /** Sample the CPU (`start`), or stop and save the profile, returning the most time-consuming functions in ms (Chromium only). */
    profile: (action: 'start' | 'stop', file?: string) => Promise<[name: string, ms: number][]>;
  }
}

/** One of each generic family: whatever fonts the engine maps them to, the invariants hold. */
export const FONTS = ['16px/20px serif', '15px/20px sans-serif', '14px/20px monospace'];

export const PROSE =
  'The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly past a sphinx of black quartz.';
export const PATH = '/Users/ada/Projects/analytical-engine/notes/2026/difference-tables.md';

/**
 * `it` for a test that fails in `engine` because of a bug found there: an
 * expected failure until it's fixed. Describe the bug in a comment by the test.
 */
export const knownBug = (engine: string): typeof it.fails => (server.browser === engine ? it.fails : it);

const elements: HTMLElement[] = [];
const created: Elide[] = [];

afterEach(() => {
  for (const t of created.splice(0)) t.destroy();
  for (const el of elements.splice(0)) el.remove();
  scrollTo(0, 0);
});

/** A block with `text`, styled by `css`, on the page until the test ends. */
export function box(text: string, css = '', parent: HTMLElement = document.body): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `font:${FONTS[0]};width:200px;${css}`;
  el.textContent = text;
  parent.append(el);
  if (parent === document.body) elements.push(el);
  return el;
}

/** `elide`, destroyed when the test ends. */
export function make(el: HTMLElement, options?: ElideOptions): Elide {
  const t = elide(el, options);
  created.push(t);
  return t;
}

/** Remove `el` when the test ends. */
export function track<T extends HTMLElement>(el: T): T {
  elements.push(el);
  return el;
}

/** Empty room on the page, pushing what comes after it down. */
export function spacer(height: number): HTMLDivElement {
  const el = track(document.createElement('div'));
  el.style.height = `${height}px`;
  document.body.append(el);
  return el;
}

export const frame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

/** Wait for `n` frames: enough for observers to have reported and passes to have run. */
export async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i++) await frame();
}

/** The element's content box, in viewport coordinates. */
export function content(el: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const px = (p: string) => parseFloat(cs.getPropertyValue(p));
  return {
    left: r.left + px('border-left-width') + px('padding-left'),
    right: r.left + el.clientLeft + el.clientWidth - px('padding-right'),
    top: r.top + px('border-top-width') + px('padding-top'),
    bottom: r.top + el.clientTop + el.clientHeight - px('padding-bottom'),
  };
}

/** The visible graphemes, joined, as the state describes them: a part showing short as its short form. */
export function visible(t: Elide): string {
  const state = t.state;
  return t.graphemes
    .map((g, i) => {
      if (!isVisible(state, i)) return '';
      const part = state.short.find((p) => i >= p.start && i < p.end);
      return !part ? g : i === part.start ? part.form : '';
    })
    .join('');
}

/**
 * The text actually rendered, without the ellipses (or the text they hide,
 * for find in page), each unit's copy (an image, an icon) as its grapheme,
 * and each short form as it's drawn.
 */
export function rendered(t: Elide): string {
  const line = t.element.querySelector('[data-fp-text]')!.cloneNode(true);
  if (!(line instanceof Element)) return '';
  for (const e of line.querySelectorAll('[data-fp-ellipsis], [data-fp-ghosts], [data-fp-found]')) e.remove();
  for (const e of line.querySelectorAll('[data-fp-unit]')) e.replaceWith(t.graphemes[Number(e.getAttribute('data-fp-unit'))]!);
  for (const e of line.querySelectorAll('[data-fp-form]')) e.replaceWith(`${e.getAttribute('data-fp-short') ?? ''}${e.textContent ?? ''}`);
  return line.textContent ?? '';
}

/** What a screen reader reads from the element's screen-reader copy: its text, generated or not. */
export function spoken(el: HTMLElement): string {
  const copy = el.querySelector('[data-fp-full]')!;
  let text = '';
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) text += node.data;
    else if (node instanceof Element) text += node.getAttribute('data-fp-say') ?? '';
  }
  return text;
}

/** How many graphemes show. */
export const shown = (t: Elide): number => t.state.length - t.state.hidden.reduce((n, p) => n + p.end - p.start, 0);

/** Horizontal ink extent of visible grapheme `i`: its laid-out box plus the font's ink metrics. */
export function inkX(t: Elide, i: number): { left: number; right: number } {
  const box = graphemeRect(t, i)!;
  const m = measure(fontOf(getComputedStyle(t.element)), t.graphemes[i]!);
  return { left: box.left - m.left, right: box.left + m.right };
}

/** Ink-to-ink gaps around ellipsis `j` and between its marks, as laid out. */
export function inkGaps(t: Elide, j: number): { left: number | null; right: number | null; inner: number[] } {
  const part = t.state.hidden[j]!;
  const marks = markInks(t, j);
  const first = marks[0]!;
  const last = marks[marks.length - 1]!;
  const before = part.start > 0 ? inkX(t, part.start - 1) : null;
  const after = part.end < t.state.length ? inkX(t, part.end) : null;
  return {
    left: before ? first.left - before.right : null,
    right: after ? after.left - last.right : null,
    inner: marks.slice(1).map((m, k) => m.left - marks[k]!.right),
  };
}

/** Collects uncaught errors (a "ResizeObserver loop" error among them) until stopped. */
export function errors(): { stop: () => string[] } {
  const seen: string[] = [];
  const onError = (e: ErrorEvent) => seen.push(e.message);
  addEventListener('error', onError);
  return {
    stop: () => {
      removeEventListener('error', onError);
      return seen;
    },
  };
}

/**
 * Lines stay inside the content box (but for the space a line wraps at, which
 * hangs past it where spaces are kept), and there are no more of them than
 * allowed. With `lines: 'fit'`, their line boxes end above its bottom.
 */
export function expectFits(t: Elide, lines = t.options.lines) {
  const c = content(t.element);
  const rects = lineRects(t);
  expect(rects.length).toBeGreaterThan(0);
  if (lines !== 'fit') expect(rects.length).toBeLessThanOrEqual(lines);
  expect(t.state.lines).toBe(rects.length);
  const cs = getComputedStyle(t.element);
  const height = parseFloat(cs.lineHeight);
  const spacing = parseFloat(cs.wordSpacing);
  const hang = cs.whiteSpace === 'pre-wrap' ? measure(fontOf(cs), ' ').advance + (Number.isFinite(spacing) ? spacing : 0) : 0;
  for (const r of rects) {
    expect(r.left).toBeGreaterThanOrEqual(c.left - 0.5);
    expect(r.right).toBeLessThanOrEqual(c.right + hang + 0.5);
    // (With line-height: normal, a line is as tall as its glyphs' box.)
    if (lines === 'fit')
      expect((r.top + r.bottom) / 2 + (Number.isNaN(height) ? r.height : height) / 2).toBeLessThanOrEqual(c.bottom + 0.5);
  }
}

/** Every line holding an ellipsis ends at the content box's right edge. */
export function expectFlush(t: Elide) {
  const right = content(t.element).right;
  const rects = lineRects(t);
  t.ellipses.forEach((_, j) => {
    const e = ellipsisRect(t, j)!;
    const middle = e.top + e.height / 2;
    const line = rects.find((r) => middle >= r.top && middle <= r.bottom)!;
    expect(line.right).toBeCloseTo(right, 0);
  });
}

/** What shows is what the state says shows, and the hidden parts fill in the rest. */
export function expectConsistent(t: Elide) {
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

/** Widths from narrow to wide, applying each and re-truncating right away. */
export function* sweep(t: Elide, from: number, to: number, step: number) {
  for (let w = from; w <= to; w += step) {
    t.element.style.width = `${w}px`;
    t.refresh();
    yield w;
  }
}
