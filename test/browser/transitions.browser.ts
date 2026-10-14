import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import type { Elide } from '#src/elide.ts';
import { isVisible } from '#src/options.ts';
import { type TransitionOptions, transitions } from '#src/transitions.ts';
import { PROSE, box, frame, frames, make } from './helpers.ts';

const stops: (() => void)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await commands.reducedMotion(false);
});

/** PROSE cut in the middle, glyph by glyph, with transitions, as painted. */
async function animated(options: TransitionOptions = {}, width = 360): Promise<Elide> {
  const t = make(box(PROSE, `width:${width}px`), { position: 'middle', glyphs: true });
  // Attached before the first pass, so leaving glyphs know where they were painted.
  stops.push(transitions(t, { pace: 'fixed', ...options }));
  expect(t.truncated).toBe(true);
  await frames();
  return t;
}

/** Narrow the element and re-truncate now. */
function narrow(t: Elide, width: number) {
  t.element.style.width = `${width}px`;
  t.refresh();
  expect(t.truncated).toBe(true);
}

const layer = (t: Elide) => t.element.querySelector<HTMLElement>('[data-fp-ghosts]')!;
const ghosts = (t: Elide) => layer(t).childElementCount;
const running = (t: Elide) => t.element.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
const finishAll = (t: Elide) => t.element.getAnimations({ subtree: true }).forEach((a) => a.finish());

/** Where every glyph showing is, by index. */
function glyphBoxes(t: Elide): Map<number, DOMRect> {
  const state = t.state;
  const boxes = new Map<number, DOMRect>();
  for (let i = 0; i < state.length; i++) if (isVisible(state, i)) boxes.set(i, t.glyph(i)!.getBoundingClientRect());
  return boxes;
}

/** The marks of every ellipsis lie between the ink of the glyphs either side, and apart. */
function expectMarksBetween(t: Elide) {
  t.state.hidden.forEach((part, j) => {
    const marks = t.marks(j);
    const before = part.start > 0 ? t.glyphInk(part.start - 1) : null;
    const after = part.end < t.state.length ? t.glyphInk(part.end) : null;
    for (const [k, m] of marks.entries()) {
      if (before) expect(m.left).toBeGreaterThanOrEqual(before.right - 0.1);
      if (after) expect(m.right).toBeLessThanOrEqual(after.left + 0.1);
      const next = marks[k + 1];
      if (next) expect(m.right).toBeLessThanOrEqual(next.left + 0.1);
    }
  });
}

describe('transitions', () => {
  it.each(['merge', 'fade', 'blur'] as const)('%s: leaving glyphs get ghosts that go away once played', async (effect) => {
    const t = await animated({ effect });
    expect(ghosts(t)).toBe(0);
    narrow(t, 240);
    expect(ghosts(t)).toBeGreaterThan(0);
    expect(running(t).length).toBeGreaterThan(0);
    finishAll(t);
    await frames(1);
    expect(ghosts(t)).toBe(0);
  });

  it('merge: arriving glyphs grow out of the ellipsis, and are drawn once they land', async () => {
    const t = await animated({ effect: 'merge' }, 240);
    const shown: number[] = [];
    t.onChange((change) => shown.push(...change.shown));
    t.element.style.width = '360px';
    t.refresh();
    expect(t.truncated).toBe(true);
    expect(shown.length).toBeGreaterThan(0);
    expect(ghosts(t)).toBeGreaterThan(0);
    for (const i of shown) expect(t.glyph(i)!.style.color).toBe('transparent');
    finishAll(t);
    await frames(1);
    expect(ghosts(t)).toBe(0);
    for (const i of shown) expect(t.glyph(i)!.style.color).toBe('');
  });

  it('none: glyphs come and go at once, but the dots still glide', async () => {
    const t = await animated({ effect: 'none' });
    narrow(t, 240);
    expect(ghosts(t)).toBe(0);
    await frame();
    const shifted = t.markElements(0).some((m) => m.style.transform !== '');
    expect(shifted).toBe(true);
  });

  it('never moves the text: glyphs keep their layout positions while things animate', async () => {
    const t = await animated({ effect: 'merge' });
    narrow(t, 240);
    const laidOut = glyphBoxes(t);
    for (let k = 0; k < 5; k++) {
      await frame();
      for (const [i, r] of glyphBoxes(t)) {
        expect(r.left).toBeCloseTo(laidOut.get(i)!.left, 2);
        expect(r.top).toBeCloseTo(laidOut.get(i)!.top, 2);
      }
    }
  });

  it('glides the dots without ever running into the text or each other', async () => {
    const t = await animated({ effect: 'merge', duration: 300 });
    for (const width of [300, 220, 170]) {
      narrow(t, width);
      expectMarksBetween(t);
      for (let k = 0; k < 8; k++) {
        await frame();
        expectMarksBetween(t);
      }
    }
  });

  it('settles the dots back onto their layout', async () => {
    const t = await animated({ effect: 'merge', duration: 200 });
    narrow(t, 240);
    await expect.poll(() => t.markElements(0).every((m) => m.style.transform === ''), { timeout: 2000 }).toBe(true);
  });

  it('glides without glyph mode too', async () => {
    const t = make(box(PROSE, 'width:360px'), { position: 'middle' });
    stops.push(transitions(t, { pace: 'fixed' }));
    await frames();
    narrow(t, 240);
    expect(ghosts(t)).toBe(0);
    await frame();
    expect(t.markElements(0).some((m) => m.style.transform !== '')).toBe(true);
  });

  it('keeps up with changes faster than it can play them', async () => {
    const t = make(box(PROSE, 'width:420px'), { position: 'middle', glyphs: true });
    stops.push(transitions(t, { effect: 'merge' }));
    await frames();
    let most = 0;
    for (let w = 420; w >= 120; w -= 6) {
      narrow(t, w);
      most = Math.max(most, running(t).length);
    }
    // Each change gets a few times the interval since the last, which here is next to nothing.
    expect(running(t)).toHaveLength(0);
    expect(most).toBeLessThan(50);
  });

  it('holds still when the user prefers reduced motion', async () => {
    await commands.reducedMotion(true);
    const t = await animated({ effect: 'merge' });
    narrow(t, 240);
    expect(ghosts(t)).toBe(0);
    expect(t.markElements(0).every((m) => m.style.transform === '')).toBe(true);
  });

  it('cleans up when stopped', async () => {
    const t = await animated({ effect: 'merge' });
    narrow(t, 240);
    for (const stop of stops.splice(0)) stop();
    expect(t.element.querySelector('[data-fp-ghosts]')).toBeNull();
    expect(t.markElements(0).every((m) => m.style.transform === '')).toBe(true);
    narrow(t, 200);
    expect(t.element.querySelector('[data-fp-ghosts]')).toBeNull();
  });
});
