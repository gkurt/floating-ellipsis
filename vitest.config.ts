import { playwright } from '@vitest/browser-playwright';
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

const reducedMotion: BrowserCommand<[on: boolean]> = async (context, on) => {
  await context.page.emulateMedia({ reducedMotion: on ? 'reduce' : 'no-preference' });
};

// Layout tests in real engines. Unit tests (pure logic) stay on `bun test`.
export default defineConfig({
  test: {
    include: ['test/browser/**/*.browser.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      viewport: { width: 1000, height: 700 },
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
      commands: { mouse, reducedMotion },
    },
  },
});
