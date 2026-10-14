/** What the browser suites share: fixtures that clean up after themselves, and layout readings. */
import { afterEach, it } from 'vitest';
import { server } from 'vitest/browser';
import { type Elide, elide } from '#src/elide.ts';
import { fontOf, measure } from '#src/metrics.ts';
import { type ElideOptions, isVisible } from '#src/options.ts';

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** The real mouse at `x`, `y` in the test frame's viewport (see vitest.config.ts). */
    mouse: (action: 'move' | 'down' | 'up', x: number, y: number) => Promise<void>;
    reducedMotion: (on: boolean) => Promise<void>;
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

/** The visible graphemes, joined, as the state describes them. */
export function visible(t: Elide): string {
  const state = t.state;
  return t.graphemes.filter((_, i) => isVisible(state, i)).join('');
}

/** The text actually rendered, without the ellipses. */
export function rendered(t: Elide): string {
  const line = t.element.querySelector('[data-fp-text]')!.cloneNode(true);
  if (!(line instanceof Element)) return '';
  for (const e of line.querySelectorAll('[data-fp-ellipsis], [data-fp-ghosts]')) e.remove();
  return line.textContent ?? '';
}

/** How many graphemes show. */
export const shown = (t: Elide): number => t.state.length - t.state.hidden.reduce((n, p) => n + p.end - p.start, 0);

/** Horizontal ink extent of visible grapheme `i`: its laid-out box plus the font's ink metrics. */
export function inkX(t: Elide, i: number): { left: number; right: number } {
  const box = t.graphemeRect(i)!;
  const m = measure(fontOf(getComputedStyle(t.element)), t.graphemes[i]!);
  return { left: box.left - m.left, right: box.left + m.right };
}

/** Ink-to-ink gaps around ellipsis `j` and between its marks, as laid out. */
export function inkGaps(t: Elide, j: number): { left: number | null; right: number | null; inner: number[] } {
  const part = t.state.hidden[j]!;
  const marks = t.marks(j);
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
