import { describe, expect, it } from 'vitest';
import { commands, server } from 'vitest/browser';
import { autoSize } from '#src/autosize.ts';
import type { Elide } from '#src/elide.ts';
import { PATH, PROSE, frames, make, track } from './helpers.ts';

/** Layouts done while `run` runs, frames included. */
async function layoutsDuring(run: () => unknown): Promise<number> {
  await frames(2);
  const before = await commands.layouts();
  await run();
  await frames(2);
  return (await commands.layouts()) - before;
}

/** Rows of CSS grid holding `cells` truncated cells each. */
function grid(rows: number, cells: number) {
  const host = track(document.createElement('div'));
  host.style.cssText = `width:900px;display:grid;grid-template-columns:repeat(${cells}, minmax(0, 1fr));font:13px/18px sans-serif`;
  for (let i = 0; i < rows * cells; i++) {
    const cell = document.createElement('div');
    cell.textContent = `${i} ${i % 2 === 1 ? PATH : PROSE}`;
    host.append(cell);
  }
  document.body.append(host);
  return host;
}

describe.runIf(server.browser === 'chromium')('layouts', () => {
  it('truncates and resizes a crowded grid with a few shared layouts', async () => {
    const host = grid(300, 3);
    let instances: Elide[] = [];
    const created = await layoutsDuring(() => {
      instances = [...host.children].map((cell) => make(cell as HTMLElement, { position: 'middle' }));
      void instances[0]!.truncated;
    });
    const resized = await layoutsDuring(() => (host.style.width = '700px'));
    // 900 instances, one after another, would take thousands.
    expect(created).toBeLessThanOrEqual(6);
    expect(resized).toBeLessThanOrEqual(6);
  });

  it('sizes rows of auto-sized flex items by their full text with a few shared layouts', async () => {
    const host = track(document.createElement('div'));
    host.style.cssText = 'width:900px;font:13px/18px sans-serif';
    for (let i = 0; i < 600; i++) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px';
      const cell = document.createElement('div');
      cell.style.cssText = 'flex:0 1 auto;min-width:0';
      cell.textContent = `${i} ${i % 2 === 1 ? PATH : PROSE}`;
      const badge = document.createElement('span');
      badge.textContent = 'badge';
      row.append(cell, badge);
      host.append(row);
    }
    document.body.append(host);
    let instances: Elide[] = [];
    const created = await layoutsDuring(() => {
      instances = [...host.children].map((row) => make(row.firstElementChild as HTMLElement, { position: 'middle', autoSize: autoSize() }));
      void instances[0]!.truncated;
    });
    const narrower = await layoutsDuring(() => (host.style.width = '500px'));
    const wider = await layoutsDuring(() => (host.style.width = '800px'));
    expect(created).toBeLessThanOrEqual(6);
    expect(narrower).toBeLessThanOrEqual(6);
    expect(wider).toBeLessThanOrEqual(6);
  });

  it('scrolls a virtual list: recycled rows take new text, or rows are remounted', async () => {
    const host = grid(30, 2);
    const cells = [...host.children] as HTMLElement[];
    const instances = cells.map((cell) => make(cell, { position: 'middle' }));
    void instances[0]!.truncated;
    // Recycled: the same elements, new text (TanStack Virtual, react-window with stable keys).
    let step = 0;
    const recycled = await layoutsDuring(async () => {
      for (; step < 10; step++) {
        instances.forEach((t, i) => t.update({ text: `${step}:${i} ${i % 2 === 1 ? PROSE : PATH}` }));
        await frames(1);
      }
    });
    // Remounted: every row's instance destroyed and made again for new text.
    let current = instances;
    const remounted = await layoutsDuring(async () => {
      for (let s = 0; s < 10; s++) {
        for (const t of current) t.destroy();
        current = cells.map((cell, i) => make(cell, { position: 'middle', text: `${s}:${i} ${i % 2 === 1 ? PATH : PROSE}` }));
        await frames(1);
      }
    });
    // Most rows' cuts are judged without rendering them (see `Predictor`).
    expect(recycled / 10).toBeLessThanOrEqual(4);
    expect(remounted / 10).toBeLessThanOrEqual(4);
  });
});
