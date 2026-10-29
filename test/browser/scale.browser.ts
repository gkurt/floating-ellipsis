import { describe, expect, it } from 'vitest';
import type { Elide } from '#src/elide.ts';
import type { ElideOptions } from '#src/options.ts';
import { FONTS, PROSE, box, expectConsistent, expectFits, expectFlush, frames, make, track } from './helpers.ts';

const SCALES = [0.25, 0.46, 1, 2];

/** A wrapper scaled by `scale` (as a zoomed canvas scales what it holds), on the page until the test ends. */
function scaled(scale: number): HTMLDivElement {
  const el = track(document.createElement('div'));
  el.style.cssText = `transform:scale(${scale});transform-origin:0 0`;
  document.body.append(el);
  return el;
}

/**
 * What a pass rendered: the cut, and the line's markup with every number in
 * it (gaps, spacing) taken out, to compare apart. (Less the instance's own
 * number in its elements' ids.)
 */
function cutOf(t: Elide) {
  const { hidden, short, lines, tightened } = t.state;
  const html = t.element.querySelector('[data-fp-text]')!.outerHTML.replace(/(data-fp-(?:found|ellipsis))="\d+:/g, '$1="');
  return {
    hidden: hidden.map((p) => [p.start, p.end]),
    short: short.map((p) => [p.start, p.end, p.form]),
    lines,
    tightened,
    markup: html.replace(/-?\d*\.?\d+/g, '#'),
    numbers: (html.match(/-?\d*\.?\d+/g) ?? []).map(Number),
  };
}

/**
 * `t`, laid out at `scale`, cut as `unscaled` is, and spaced as it is to
 * within the precision of the boxes it read: Chromium and WebKit give a
 * transformed box to a 64th of a screen pixel.
 */
function expectSameCut(t: Elide, unscaled: Elide, scale: number) {
  const { numbers, ...cut } = cutOf(t);
  const { numbers: want, ...wanted } = cutOf(unscaled);
  expect(cut).toEqual(wanted);
  expect(numbers).toHaveLength(want.length);
  const precision = Math.max(0.01, 1 / 64 / scale);
  numbers.forEach((n, i) => expect(Math.abs(n - want[i]!)).toBeLessThan(precision));
}

describe.each(FONTS)('under a scaled ancestor, in %s', (font) => {
  const cases: [string, ElideOptions, string][] = [
    ['one line, ellipsis at the end', { position: 'end' }, ''],
    ['one line, ellipsis in the middle', { position: 'middle' }, ''],
    ['one line, ellipsis at the start', { position: 'start' }, ''],
    ['three lines, ellipsis at the end', { lines: 3 }, ''],
    ['three lines, ellipsis in the middle', { lines: 3, position: 'middle' }, ''],
    ['as many lines as fit', { lines: 'fit' }, 'height:50px;padding:3px 5px'],
    ['tightened', { tighten: '0.05em' }, ''],
    ['tightened in the middle, with padding and a border', { tighten: '0.05em', position: 'middle' }, 'padding:0 7px;border:3px solid'],
  ];

  it.each(cases)('cuts as it does unscaled: %s', (_, options, css) => {
    const instances = SCALES.map((scale) => make(box(PROSE, `font:${font};${css}`, scaled(scale)), options));
    const unscaled = instances[SCALES.indexOf(1)]!;
    let truncated = 0;
    for (let w = 40; w <= 600; w += 13) {
      for (const t of instances) {
        t.element.style.width = `${w}px`;
        t.refresh();
      }
      instances.forEach((t, i) => {
        expectConsistent(t);
        expectSameCut(t, unscaled, SCALES[i]!);
      });
      expectFits(unscaled);
      if (!unscaled.truncated) continue;
      expectFlush(unscaled);
      truncated++;
    }
    expect(truncated).toBeGreaterThan(10);
  });

  it('cuts as it did at the scale it was laid out at, once the scale changes', async () => {
    const wrapper = scaled(0.46);
    const t = make(box(PROSE, `font:${font};width:230px`, wrapper), { position: 'middle' });
    const unscaled = make(box(PROSE, `font:${font};width:230px`, scaled(1)), { position: 'middle' });
    expect(t.truncated).toBe(true);
    for (const scale of [1, 2, 0.25]) {
      wrapper.style.transform = `scale(${scale})`;
      await frames();
      expectSameCut(t, unscaled, 0.46);
    }
  });
});

it('shows short text whole when an ancestor scales it down', () => {
  // A tile on a zoomed out canvas: the canvas scales the world, and the tile its own content.
  const tile = document.createElement('div');
  tile.style.cssText = 'transform:scale(0.92);transform-origin:0 0';
  scaled(0.5).append(tile);
  const el = document.createElement('span');
  el.style.cssText = 'display:block;box-sizing:border-box;width:186px;padding:0 12px;font:13px sans-serif';
  el.textContent = '7 open pull requests';
  tile.append(el);
  const t = make(el);
  expect(t.truncated).toBe(false);
});
