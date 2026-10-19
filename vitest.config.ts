import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import type { CDPSession, Page } from 'playwright';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

type MouseAction = 'move' | 'down' | 'up' | 'press';

/**
 * The real mouse at `x`, `y` in the test frame's viewport. Vitest runs each
 * test file in an iframe, possibly scaled, so the point is mapped onto the page.
 * `'press'` presses `times` times in one go, so pages counting presses by
 * time see them as one double or triple press however slow the round trips.
 */
const mouse: BrowserCommand<[action: MouseAction, x: number, y: number, times?: number]> = async (context, action, x, y, times = 1) => {
  const frame = await context.frame();
  const box = await (await frame.frameElement()).boundingBox();
  if (!box) throw new Error('The test frame is not laid out');
  const width = await frame.evaluate(() => innerWidth);
  const scale = box.width / width;
  await context.page.mouse.move(box.x + x * scale, box.y + y * scale);
  if (action === 'down') await context.page.mouse.down();
  if (action === 'up') await context.page.mouse.up();
  if (action !== 'press') return;
  for (let i = 0; i < times; i++) {
    await context.page.mouse.down();
    await context.page.mouse.up();
  }
};

/** Each browser's turn with the pointer: the one before it, done when it's given back. */
const turns = new WeakMap<object, Promise<void>>();
const giving = new WeakMap<object, () => void>();

/**
 * Test files run side by side, each in a browser context of its own, and
 * pressing, dragging and focusing in one disturbs another (in Firefox, a
 * press there focuses nothing): those that do take turns, from `'take'` (in
 * a `beforeEach`) to `'give'` (in an `afterEach`), their page in front
 * meanwhile.
 */
const pointer: BrowserCommand<[action: 'take' | 'give']> = async (context, action) => {
  const browser = context.page.context().browser() ?? context.page;
  if (action === 'give') {
    giving.get(browser)?.();
    giving.delete(browser);
    return;
  }
  const before = turns.get(browser) ?? Promise.resolve();
  let give = () => {};
  turns.set(browser, new Promise<void>((resolve) => (give = resolve)));
  await before;
  giving.set(browser, give);
  await context.page.bringToFront();
};

const sessions = new WeakMap<object, CDPSession>();

/** The DevTools protocol session for the page, its performance metrics on (Chromium only). */
async function devtools(page: Page): Promise<CDPSession> {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    sessions.set(page, cdp);
  }
  return cdp;
}

/** The page's performance metrics so far, by name: counts, and durations in seconds (Chromium only). */
const metrics: BrowserCommand = async (context) => {
  const { metrics } = await (await devtools(context.page)).send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
};

/** How many layouts the page has done so far (Chromium only). */
const layouts: BrowserCommand = async (context) => {
  const { metrics } = await (await devtools(context.page)).send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'LayoutCount')?.value ?? 0;
};

/**
 * Sample the page's CPU while running (`start`), then stop and save the
 * profile to `file` (`stop`), returning the functions that took the most
 * time themselves, in ms (Chromium only). Open the file in DevTools'
 * Performance panel.
 */
const profile: BrowserCommand<[action: 'start' | 'stop', file?: string]> = async (context, action, file) => {
  const cdp = await devtools(context.page);
  if (action === 'start') {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    return [];
  }
  const { profile } = await cdp.send('Profiler.stop');
  if (file) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(profile));
  }
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  const deltas = profile.timeDeltas ?? [];
  (profile.samples ?? []).forEach((id, i) => {
    const { functionName, url, lineNumber } = byId.get(id)!.callFrame;
    const name = `${functionName || '(anonymous)'} ${url.split('/').pop()}:${lineNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + (deltas[i + 1] ?? 0) / 1000);
  });
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
};

const reducedMotion: BrowserCommand<[on: boolean]> = async (context, on) => {
  await context.page.emulateMedia({ reducedMotion: on ? 'reduce' : 'no-preference' });
};

// Layout tests in real engines. Unit tests (pure logic) stay on `bun test`.
// `--mode bench` runs the benchmarks instead (`*.bench.ts`, Chromium only).
export default defineConfig(({ mode }) => {
  const bench = mode === 'bench';
  return {
    // Found up front, so Vite doesn't reload a test to add them (React would load twice).
    optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react-dom/server', 'vue'] },
    define: bench
      ? {
          'import.meta.env.BENCH_PROFILE': JSON.stringify(process.env.BENCH_PROFILE ?? ''),
          'import.meta.env.BENCH_REPS': JSON.stringify(process.env.BENCH_REPS ?? ''),
        }
      : {},
    test: {
      include: bench ? ['test/browser/**/*.bench.ts'] : ['test/browser/**/*.browser.ts'],
      testTimeout: bench ? 300_000 : undefined,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        viewport: { width: 1000, height: 700 },
        instances: bench ? [{ browser: 'chromium' }] : [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
        commands: { mouse, pointer, reducedMotion, layouts, metrics, profile },
      },
    },
  };
});
