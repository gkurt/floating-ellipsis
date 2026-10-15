/**
 * Benchmarks: `bun run bench` (Chromium only). Each scenario is run a few
 * times and reports the median main-thread time it took (script, layout and
 * style, from the DevTools protocol) and how many layouts. `BENCH_PROFILE=1`
 * also samples the CPU and prints the functions that took the most time,
 * saving each profile in `.vitest/profiles` for DevTools.
 */
import { afterAll, describe, it } from 'vitest';
import { commands } from 'vitest/browser';
import { type ElideChange, onChange } from '#src/changes.ts';
import { type Elide, elide } from '#src/elide.ts';
import { glyphs } from '#src/glyphs.ts';
import { separators, words } from '#src/index.ts';
import type { ElideOptions } from '#src/options.ts';
import { PROSE, frames } from './helpers.ts';

const PROFILE = import.meta.env.BENCH_PROFILE === '1';
const REPS = Number(import.meta.env.BENCH_REPS || 5);

interface Sample {
  /** Wall time of `run` itself: what a synchronous run costs (a run that waits for frames counts the wait). */
  wall: number;
  task: number;
  script: number;
  layout: number;
  style: number;
  layouts: number;
}

const results: [string, Sample][] = [];

/** Seeded, so every run truncates the same text. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = random(7);
const SEGMENTS = 'src components docs assets archive 2026 reports shared design legacy exports finance platform web vendor'.split(' ');
const WORDS = PROSE.toLowerCase().replace('.', '').split(' ');
const path = () => `/${Array.from({ length: 4 + Math.floor(r() * 6) }, () => SEGMENTS[Math.floor(r() * SEGMENTS.length)]).join('/')}.md`;
const prose = (count: number) => Array.from({ length: count }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');

type Markup = 'grid' | 'wrapped' | 'table';

/**
 * Rows of `cells` cells each, holding `text(i)`: in CSS grid, the truncated
 * elements its items or (`wrapped`) inside them, or in a `<table>`, inside its cells.
 */
function grid(rows: number, cells: number, text: (i: number) => string, css = '', markup: Markup = 'grid') {
  const host = document.createElement(markup === 'table' ? 'table' : 'div');
  host.style.cssText =
    markup === 'table'
      ? `width:900px;table-layout:fixed;border-collapse:collapse;font:13px/18px sans-serif;${css}`
      : `width:900px;display:grid;grid-template-columns:repeat(${cells}, minmax(0, 1fr));font:13px/18px sans-serif;${css}`;
  const truncated: HTMLElement[] = [];
  for (let row = 0; row < rows; row++) {
    const tr = markup === 'table' ? host.appendChild(document.createElement('tr')) : host;
    for (let c = 0; c < cells; c++) {
      const cell = document.createElement('div');
      cell.textContent = text(row * cells + c);
      truncated.push(cell);
      if (markup === 'grid') tr.append(cell);
      else tr.appendChild(document.createElement(markup === 'table' ? 'td' : 'div')).append(cell);
    }
  }
  document.body.append(host);
  return { host, cells: truncated };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

/**
 * Run `run` on what `setup` made, `REPS` times, each after a fresh setup
 * (torn down by `teardown`), and record the median costs.
 */
async function bench<T>(name: string, setup: () => T | Promise<T>, run: (ctx: T) => unknown, teardown: (ctx: T) => void) {
  const samples: Sample[] = [];
  for (let rep = 0; rep < REPS; rep++) {
    const ctx = await setup();
    await frames(3);
    const before = await commands.metrics();
    if (PROFILE && rep === 0) await commands.profile('start');
    const start = performance.now();
    await run(ctx);
    const wall = performance.now() - start;
    await frames(2);
    // Work put off until passes pause (filling what find in page searches) counts too.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const top = PROFILE && rep === 0 ? await commands.profile('stop', `.vitest/profiles/${name.replace(/\W+/g, '-')}.cpuprofile`) : [];
    const after = await commands.metrics();
    const ms = (key: string) => (after[key]! - before[key]!) * 1000;
    samples.push({
      wall,
      task: ms('TaskDuration'),
      script: ms('ScriptDuration'),
      layout: ms('LayoutDuration'),
      style: ms('RecalcStyleDuration'),
      layouts: after.LayoutCount! - before.LayoutCount!,
    });
    if (top.length > 0) console.log(`${name}\n${top.map(([fn, t]) => `  ${t.toFixed(1).padStart(8)} ms  ${fn}`).join('\n')}`);
    teardown(ctx);
    await frames(2);
  }
  const sample: Sample = {
    wall: median(samples.map((s) => s.wall)),
    task: median(samples.map((s) => s.task)),
    script: median(samples.map((s) => s.script)),
    layout: median(samples.map((s) => s.layout)),
    style: median(samples.map((s) => s.style)),
    layouts: median(samples.map((s) => s.layouts)),
  };
  results.push([name, sample]);
}

interface Made {
  host: HTMLElement;
  cells: HTMLElement[];
  instances: Elide[];
}

function teardown({ host, instances }: Made) {
  for (const t of instances) t.destroy();
  host.remove();
}

/** A grid of `rows` × `cells`, truncated with `options` (or per cell), listening with `options.onChange`. */
function made(
  rows: number,
  cells: number,
  text: (i: number) => string,
  options: (i: number) => ElideOptions & { onChange?: (change: ElideChange) => void },
  markup: Markup = 'grid',
) {
  return async (): Promise<Made> => {
    const g = grid(rows, cells, text, '', markup);
    const instances = g.cells.map((cell, i) => {
      const { onChange: listener, ...rest } = options(i);
      const t = elide(cell, rest);
      if (listener) onChange(t, listener);
      return t;
    });
    void instances[0]!.truncated;
    await frames(2);
    return { ...g, instances };
  };
}

/** Narrow the host step by step, a frame apart, as when dragging a column. */
async function drag({ host }: Made, from = 900, to = 600, steps = 10) {
  for (let s = 1; s <= steps; s++) {
    host.style.width = `${from + ((to - from) * s) / steps}px`;
    await frames(1);
  }
}

const mixed = (i: number) => `${i} ${i % 2 === 1 ? path() : prose(18)}`;

afterAll(() => {
  const pad = (v: number | string, n = 9) => (typeof v === 'number' ? v.toFixed(1) : v).padStart(n);
  const header = `${'scenario'.padEnd(42)}${pad('wall ms')}${pad('task')}${pad('script')}${pad('layout')}${pad('style')}${pad('layouts')}`;
  const rows = results.map(
    ([name, s]) => `${name.padEnd(42)}${pad(s.wall)}${pad(s.task)}${pad(s.script)}${pad(s.layout)}${pad(s.style)}${pad(String(s.layouts))}`,
  );
  console.log(`\n${header}\n${rows.join('\n')}\n`);
});

describe('bench', () => {
  it('nothing, for the overhead of measuring', async () => {
    await bench(
      '(nothing)',
      () => null,
      () => {},
      () => {},
    );
  });

  it('a crowded table', async () => {
    // Most rows are far off screen: their passes wait until they come near.
    await bench(
      'table: create 900',
      (): Made => ({ ...grid(300, 3, mixed), instances: [] }),
      (m) => {
        m.instances = m.cells.map((cell) => elide(cell, { position: 'middle' }));
        void m.instances[0]!.truncated;
      },
      teardown,
    );
    await bench(
      'table: drag 900',
      made(300, 3, mixed, () => ({ position: 'middle' })),
      (m) => drag(m),
      teardown,
    );
    await bench(
      'table: drag 900 in a <table>',
      made(300, 3, mixed, () => ({ position: 'middle' }), 'table'),
      (m) => drag(m),
      teardown,
    );
    await bench(
      'table: drag 900, find: false',
      made(300, 3, mixed, () => ({ position: 'middle', find: false })),
      (m) => drag(m),
      teardown,
    );
    await bench(
      'table: scroll 900',
      made(300, 3, mixed, () => ({ position: 'middle' })),
      async () => {
        for (let s = 0; s < 8; s++) {
          scrollBy(0, 600);
          await frames(1);
        }
      },
      (m) => {
        teardown(m);
        scrollTo(0, 0);
      },
    );
  });

  it('every row truncated at once', async () => {
    // Not observed: every pass runs, near the screen or not.
    const all = (options: ElideOptions = {}) => made(200, 3, mixed, () => ({ position: 'middle', observe: false, ...options }));
    const refreshAll = async ({ host, instances }: Made, width = 700) => {
      host.style.width = `${width}px`;
      for (const t of instances) t.refresh();
      void instances[0]!.truncated;
    };
    await bench('all 600: refresh', all(), (m) => refreshAll(m), teardown);
    await bench(
      'all 600: refresh, wrapped in grid items',
      made(200, 3, mixed, () => ({ position: 'middle', observe: false }), 'wrapped'),
      (m) => refreshAll(m),
      teardown,
    );
    await bench(
      'all 600: refresh, in a <table>',
      made(200, 3, mixed, () => ({ position: 'middle', observe: false }), 'table'),
      (m) => refreshAll(m),
      teardown,
    );
    await bench('all 600: refresh, justify ellipsis', all({ justify: 'ellipsis' }), (m) => refreshAll(m), teardown);
    await bench('all 600: refresh, justify false', all({ justify: false }), (m) => refreshAll(m), teardown);
    await bench('all 600: refresh, words()', all({ snap: words(), position: 'end' }), (m) => refreshAll(m), teardown);
    await bench(
      'all 600: refresh, separators + keep',
      made(
        200,
        3,
        () => path(),
        () => ({ observe: false, snap: separators('/'), keep: { match: /[^/]+$/, class: 'name' } }),
      ),
      (m) => refreshAll(m),
      teardown,
    );
    await bench(
      'all 600: update text',
      all(),
      ({ instances }) => {
        instances.forEach((t, i) => t.update({ text: mixed(i + 1) }));
        void instances[0]!.truncated;
      },
      teardown,
    );
  });

  it('a virtual list', async () => {
    const list = made(30, 2, mixed, () => ({ position: 'middle' }));
    await bench(
      'virtual 60: recycle ×10',
      list,
      async ({ instances }) => {
        for (let s = 0; s < 10; s++) {
          instances.forEach((t, i) => t.update({ text: `${s}:${i} ${i % 2 === s % 2 ? prose(18) : path()}` }));
          await frames(1);
        }
      },
      teardown,
    );
  });

  it('several lines', async () => {
    await bench(
      'paragraphs 150 × 3 lines: drag',
      made(
        50,
        3,
        () => prose(80),
        () => ({ lines: 3 }),
      ),
      (m) => drag(m),
      teardown,
    );
    await bench(
      'paragraphs 150 × 3, words(): drag',
      made(
        50,
        3,
        () => prose(80),
        () => ({ lines: 3, snap: words() }),
      ),
      (m) => drag(m),
      teardown,
    );
  });

  it('long text', async () => {
    await bench(
      'long 10 × 5k chars, 2 lines: drag',
      made(
        10,
        1,
        () => prose(900),
        () => ({ lines: 2, position: 'middle' }),
      ),
      (m) => drag(m, 900, 600, 6),
      teardown,
    );
  });

  it('glyphs and listeners', async () => {
    await bench(
      'glyphs 100 + onChange: drag',
      made(
        50,
        2,
        (i) => (i % 2 === 1 ? path() : prose(12)),
        () => ({ glyphs, position: 'middle', onChange: () => {} }),
      ),
      (m) => drag(m),
      teardown,
    );
  });
});
