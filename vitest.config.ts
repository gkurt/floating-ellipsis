import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import type { CDPSession, Page } from 'playwright';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

type MouseAction = 'move' | 'down' | 'up';

/**
 * The real mouse at `x`, `y` in the test frame's viewport. Vitest runs each
 * test file in an iframe, possibly scaled, so the point is mapped onto the page.
 */
const mouse: BrowserCommand<[action: MouseAction, x: number, y: number]> = async (context, action, x, y) => {
  const frame = await context.frame();
  const box = await (await frame.frameElement()).boundingBox();
  if (!box) throw new Error('The test frame is not laid out');
  const width = await frame.evaluate(() => innerWidth);
  const scale = box.width / width;
  await context.page.mouse.move(box.x + x * scale, box.y + y * scale);
  if (action === 'down') await context.page.mouse.down();
  if (action === 'up') await context.page.mouse.up();
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
        commands: { mouse, reducedMotion, layouts, metrics, profile },
      },
    },
  };
});
