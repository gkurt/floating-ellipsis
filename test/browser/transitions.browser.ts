import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { onChange } from '#src/changes.ts';
import type { Elide } from '#src/elide.ts';
import { markElements, markInks } from '#src/geometry.ts';
import { glyph, glyphInk, glyphs } from '#src/glyphs.ts';
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
  const t = make(box(PROSE, `width:${width}px`), { position: 'middle', glyphs });
  // Attached before the first pass, so leaving glyphs know where they were painted.
  stops.push(transitions(t, options));
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

/**
 * Narrow the element a pixel at a time until more is cut: the smallest step,
 * which leaves the glyphs going room to be drawn in whatever fonts the
 * engine has. A fixed step can squeeze them out at once.
 */
function cutMore(t: Elide) {
  const hidden = JSON.stringify(t.state.hidden);
  for (let width = t.element.offsetWidth - 1; JSON.stringify(t.state.hidden) === hidden; width--) narrow(t, width);
}

const layer = (t: Elide) => t.element.querySelector<HTMLElement>('[data-fp-ghosts]')!;
const ghosts = (t: Elide) => layer(t).childElementCount;
const settled = (t: Elide) => expect.poll(() => ghosts(t), { timeout: 3000 }).toBe(0);

/**
 * Where glyphs on their way in or out are drawn over the text showing, the
 * marks or each other, by more than the font itself overlaps them. Arriving
 * glyphs stand in for a glyph laid out (and hidden) beneath them, which
 * gives how much the font overlaps them with their neighbours.
 */
function overlaps(t: Elide): string[] {
  const state = t.state;
  const showing: { text: string; ink: DOMRect }[] = [];
  const beneath: { text: string; ink: DOMRect }[] = [];
  for (let i = 0; i < state.length; i++) {
    const text = t.graphemes[i]!;
    const ink = isVisible(state, i) && text.trim() ? glyphInk(t, i) : null;
    if (ink && ink.width > 0) (glyph(t, i)!.style.color === 'transparent' ? beneath : showing).push({ text, ink });
  }
  const marks = state.hidden.flatMap((_, j) => markInks(t, j));
  const drawn = [...layer(t).children]
    .map((el) => ({ text: el.textContent, ink: el.getBoundingClientRect(), opacity: Number(getComputedStyle(el).opacity) }))
    .filter((g) => g.ink.width > 0 && g.opacity > 0.01);
  const over = (a: DOMRect, b: DOMRect) =>
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5 ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) : 0;
  const under = (g: { text: string; ink: DOMRect }) =>
    beneath.find((b) => b.text === g.text && g.ink.left >= b.ink.left - 0.5 && g.ink.right <= b.ink.right + 0.5)?.ink;
  const out: string[] = [];
  drawn.forEach((g, k) => {
    const home = under(g);
    for (const s of showing) if (over(g.ink, s.ink) > (home ? over(home, s.ink) : 0) + 0.5) out.push(`'${g.text}' over '${s.text}'`);
    for (const m of marks) if (over(g.ink, m) > 0.5) out.push(`'${g.text}' over a mark`);
    for (const h of drawn.slice(k + 1)) {
      const other = under(h);
      if (over(g.ink, h.ink) > (home && other ? over(home, other) : 0) + 0.5) out.push(`'${g.text}' over '${h.text}'`);
    }
  });
  return out;
}

/** Where every glyph showing is, by index. */
function glyphBoxes(t: Elide): Map<number, DOMRect> {
  const state = t.state;
  const boxes = new Map<number, DOMRect>();
  for (let i = 0; i < state.length; i++) if (isVisible(state, i)) boxes.set(i, glyph(t, i)!.getBoundingClientRect());
  return boxes;
}

/** The marks of every ellipsis lie between the ink of the glyphs either side, and apart. */
function expectMarksBetween(t: Elide) {
  t.state.hidden.forEach((part, j) => {
    const marks = markInks(t, j);
    const before = part.start > 0 ? glyphInk(t, part.start - 1) : null;
    const after = part.end < t.state.length ? glyphInk(t, part.end) : null;
    for (const [k, m] of marks.entries()) {
      if (before) expect(m.left).toBeGreaterThanOrEqual(before.right - 0.1);
      if (after) expect(m.right).toBeLessThanOrEqual(after.left + 0.1);
      const next = marks[k + 1];
      if (next) expect(m.right).toBeLessThanOrEqual(next.left + 0.1);
    }
  });
}

describe('transitions', () => {
  it.each(['merge', 'fade', 'blur'] as const)('%s: leaving glyphs are drawn until they have gone', async (effect) => {
    const t = await animated({ effect, duration: 200 });
    expect(ghosts(t)).toBe(0);
    cutMore(t);
    expect(ghosts(t)).toBeGreaterThan(0);
    await settled(t);
  });

  it('merge: a leaving glyph only shrinks and fades, in the room left beside the dots', async () => {
    const t = await animated({ effect: 'merge', duration: 300 });
    cutMore(t);
    const sprite = layer(t).firstElementChild as HTMLElement;
    expect(sprite).not.toBeNull();
    const scales: number[] = [];
    for (let k = 0; k < 6 && sprite.isConnected; k++) {
      await frame();
      scales.push(Number(sprite.style.opacity));
      // No shape turning into a dot: the text alone.
      expect(sprite.childElementCount).toBe(1);
      expect(sprite.style.transform).toMatch(/^scale\(/);
    }
    expect(scales.length).toBeGreaterThan(1);
    expect(scales.every((v, k) => k === 0 || v <= scales[k - 1]!)).toBe(true);
  });

  it.each([
    ['merge', 0.5],
    ['merge', 1],
    ['merge', 0],
    ['fade', 0.5],
  ] as const)('%s at %s: glyphs coming and going never overlap the text, the marks or each other', async (effect, position) => {
    const t = make(box(PROSE, 'width:360px'), { position, glyphs });
    stops.push(transitions(t, { effect }));
    await frames();
    const seen: string[] = [];
    const widths = [...Array.from({ length: 40 }, (_, k) => 360 - k * 3), ...Array.from({ length: 40 }, (_, k) => 240 + k * 3)];
    let drawn = 0;
    for (const width of widths) {
      t.element.style.width = `${width}px`;
      t.refresh();
      await frame();
      drawn += ghosts(t);
      seen.push(...overlaps(t).map((o) => `${width}px: ${o}`));
    }
    expect(drawn).toBeGreaterThan(0);
    expect(seen).toEqual([]);
  });

  it('animates the first change after being attached late', async () => {
    const t = make(box(PROSE, 'width:360px'), { position: 'middle', glyphs });
    expect(t.truncated).toBe(true);
    await frames();
    stops.push(transitions(t));
    cutMore(t);
    expect(ghosts(t)).toBeGreaterThan(0);
  });

  it('merge: arriving glyphs grow in their own place, and are drawn once they land', async () => {
    const t = await animated({ effect: 'merge', duration: 200 }, 240);
    const shown: number[] = [];
    onChange(t, (change) => shown.push(...change.shown));
    t.element.style.width = '360px';
    t.refresh();
    expect(t.truncated).toBe(true);
    const inked = shown.filter((i) => t.graphemes[i]!.trim());
    expect(inked.length).toBeGreaterThan(0);
    expect(ghosts(t)).toBeGreaterThan(0);
    for (const i of inked) expect(glyph(t, i)!.style.color).toBe('transparent');
    await settled(t);
    for (const i of shown) expect(glyph(t, i)!.style.color).toBe('');
  });

  it('none: glyphs come and go at once, but the dots still glide', async () => {
    const t = await animated({ effect: 'none' });
    narrow(t, 240);
    expect(ghosts(t)).toBe(0);
    await frame();
    const shifted = markElements(t, 0).some((m) => m.style.transform !== '');
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
    await expect.poll(() => markElements(t, 0).every((m) => m.style.transform === ''), { timeout: 2000 }).toBe(true);
  });

  it('keeps every ellipsis centred where layout puts it: only the spacing glides', async () => {
    const t = await animated({ effect: 'merge', duration: 300 });
    const middle = () => {
      const marks = markInks(t, 0);
      return (marks[0]!.left + marks.at(-1)!.right) / 2;
    };
    narrow(t, 240);
    const centres: number[] = [];
    let spread = false;
    for (let k = 0; k < 6; k++) {
      await frame();
      centres.push(middle());
      spread ||= markElements(t, 0).some((m) => m.style.transform !== '');
    }
    expect(spread).toBe(true);
    await expect.poll(() => markElements(t, 0).every((m) => m.style.transform === ''), { timeout: 2000 }).toBe(true);
    for (const c of centres) expect(c).toBeCloseTo(middle(), 1);
  });

  it('glides without glyph mode too', async () => {
    const t = make(box(PROSE, 'width:360px'), { position: 'middle' });
    stops.push(transitions(t));
    await frames();
    narrow(t, 240);
    expect(ghosts(t)).toBe(0);
    await frame();
    expect(markElements(t, 0).some((m) => m.style.transform !== '')).toBe(true);
  });

  it('arriving glyphs take their time, however fast the text widens', async () => {
    const t = make(box(PROSE, 'width:200px'), { position: 'middle', glyphs });
    stops.push(transitions(t));
    await frames();
    for (let w = 200; w <= 300; w += 6) {
      t.element.style.width = `${w}px`;
      t.refresh();
      expect(t.truncated).toBe(true);
    }
    expect(ghosts(t)).toBeGreaterThan(0);
    await settled(t);
  });

  it('keeps up with changes faster than it can play them', async () => {
    const t = make(box(PROSE, 'width:420px'), { position: 'middle', glyphs });
    stops.push(transitions(t, { effect: 'merge' }));
    await frames();
    let most = 0;
    for (let w = 420; w >= 120; w -= 6) {
      narrow(t, w);
      most = Math.max(most, ghosts(t));
    }
    // Each change gets a few times the interval since the last, which here is next to nothing.
    expect(ghosts(t)).toBe(0);
    expect(most).toBeLessThan(10);
  });

  it('holds still when the user prefers reduced motion', async () => {
    await commands.reducedMotion(true);
    const t = await animated({ effect: 'merge' });
    narrow(t, 240);
    expect(ghosts(t)).toBe(0);
    expect(markElements(t, 0).every((m) => m.style.transform === '')).toBe(true);
  });

  it('cleans up when stopped', async () => {
    const t = await animated({ effect: 'merge' });
    narrow(t, 240);
    for (const stop of stops.splice(0)) stop();
    expect(t.element.querySelector('[data-fp-ghosts]')).toBeNull();
    expect(markElements(t, 0).every((m) => m.style.transform === '')).toBe(true);
    narrow(t, 200);
    expect(t.element.querySelector('[data-fp-ghosts]')).toBeNull();
  });
});
