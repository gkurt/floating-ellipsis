import { type Locator, type Page, expect, test } from '@playwright/test';
import { FILES, LINK, PATH, SHORT, folderOf, nameOf } from '@/lib/files';

const REQUESTED = '/srv/www/releases/2026-10-18/build-artifacts/floating-ellipsis/coverage/report.html';
const PAGES = [
  { name: 'static', url: '/', path: PATH },
  { name: 'dynamic', url: `/ssr?path=${encodeURIComponent(REQUESTED)}`, path: REQUESTED },
];

/** What the page logs as errors and warnings, React's hydration mismatches among them. */
function problems(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') seen.push(m.text());
  });
  page.on('pageerror', (e) => seen.push(e.message));
  return seen;
}

/** Until every element the server rendered for fallback.css has its instance. */
async function hydrated(page: Page) {
  await expect(page.locator('[data-elide-fallback]:not([data-elide])')).toHaveCount(0);
  const count = await page.locator('[data-elide-fallback]').count();
  expect(count).toBeGreaterThan(30);
  await expect(page.locator('[data-elide]')).toHaveCount(count);
}

/** Until the fonts have loaded too: laying the text out again closes a tip. */
async function settled(page: Page) {
  await hydrated(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * Rest the pointer on `target` until `tip` shows: tips are attached just
 * after hydrating, so a pointer that came first is moved again.
 */
async function rest(page: Page, target: Locator, tip: Locator) {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await target.hover();
    await expect(tip).toBeVisible({ timeout: 1500 });
  }).toPass();
}

/** The text of every element whose content is wider than its box. */
const overflowing = (page: Page) =>
  page.$$eval('[data-elide-fallback]', (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));

/** What an instance shows: its line, without the screen-reader copy. */
const shown = (page: Page, testId: string) => page.getByTestId(testId).locator('[data-elide]').first().innerText();

test.describe('the server', () => {
  // Once is enough: no browser is involved.
  test.beforeEach(() => test.skip(test.info().project.name !== 'chromium'));

  test('prerenders the static page, its text marked for fallback.css', async ({ request }) => {
    const response = await request.get('/');
    expect(response.headers()['x-nextjs-prerender']).toBeTruthy();
    const html = await response.text();
    expect(html).toContain(`data-elide-fallback="">${PATH}</span>`);
    expect(html).toContain(`data-slot="tooltip-trigger" data-elide-fallback="">${SHORT}</div>`);
    for (const file of FILES) expect(html).toContain(`data-elide-fallback="">${file.path}</div>`);
    expect(html).toContain('data-elide-fallback="2">');
  });

  test('renders the dynamic page on each request', async ({ request }) => {
    for (const path of [REQUESTED, '/tmp/another/request.txt']) {
      const response = await request.get(`/ssr?path=${encodeURIComponent(path)}`);
      expect(response.headers()['x-nextjs-prerender']).toBeUndefined();
      expect(await response.text()).toContain(`data-elide-fallback="">${path}</span>`);
    }
  });
});

test.describe('before hydrating', () => {
  test.use({ javaScriptEnabled: false });

  test('fallback.css cuts the text at the end', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByTestId('radix-trigger').first();
    await expect(trigger).toHaveCSS('text-overflow', 'ellipsis');
    await expect(trigger).not.toHaveAttribute('data-elide');
    expect(await trigger.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  });
});

for (const { name, url, path } of PAGES) {
  test.describe(`the ${name} page`, () => {
    test('hydrates without errors, and every instance fits its box', async ({ page }) => {
      const logged = problems(page);
      await page.goto(url);
      await hydrated(page);
      expect(await overflowing(page)).toEqual([]);
      for (const kind of ['radix', 'base']) {
        await expect(page.getByTestId(`${kind}-trigger`).first()).toHaveAttribute('data-truncated');
        await expect(page.getByTestId(`${kind}-trigger`).last()).not.toHaveAttribute('data-truncated');
      }
      const text = await shown(page, 'file-button');
      expect(text.length).toBeLessThan(path.length);
      expect(path.startsWith(text.slice(0, 5))).toBe(true);
      expect(text.endsWith(nameOf(path))).toBe(true);
      expect(logged).toEqual([]);
    });

    test('refits for a phone', async ({ page }) => {
      await page.goto(url);
      await hydrated(page);
      const cell = page.getByTestId('files-table').locator('[data-elide]').first();
      const before = (await cell.boundingBox())!.width;
      // The panels beside the table go, and so do its other columns. The
      // name column narrows, and each line is truncated again to fit it
      // (sometimes to the same text: the folders go before the name does).
      await page.setViewportSize({ width: 390, height: 720 });
      await expect.poll(async () => (await cell.boundingBox())!.width).toBeLessThan(before);
      await expect.poll(() => overflowing(page)).toEqual([]);
      await expect(cell).toHaveAttribute('data-truncated');
    });
  });
}

test('the window refits what it holds as its edge is dragged', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  const window = page.getByTestId('app-window');
  const handle = page.getByRole('button', { name: /Resize the window/ }).last();
  const before = (await window.boundingBox())!;
  const box = (await handle.locator('span').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await window.boundingBox())!.width).toBeLessThan(before.width - 500);
  // The details panel goes; the table stays, cut tighter.
  await expect(page.getByTestId('details')).toBeHidden();
  expect(await overflowing(page)).toEqual([]);
  const rows = page.getByTestId('files-table').locator('[data-tip-row]');
  for (const i of [0, 1, 2, 3, 4]) await expect(rows.nth(i).locator('[data-elide]').first()).toHaveAttribute('data-truncated');
  // A name that fits is kept whole.
  expect((await rows.first().locator('[data-elide]').first().innerText()).endsWith(nameOf(PATH))).toBe(true);
  // Arrow keys move it too, and a double click puts it back.
  await handle.focus();
  const narrow = (await window.boundingBox())!.width;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await window.boundingBox())!.width).toBeGreaterThan(narrow);
  await handle.dblclick();
  await expect.poll(async () => (await window.boundingBox())!.width).toBe(before.width);
});

test('a row grows its path back over the line, and closes as the pointer leaves', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  const row = page.getByTestId('files-table').locator('[data-tip-row]').nth(2);
  await expect(row.locator('[data-elide]').first()).toHaveAttribute('data-truncated');
  const tip = page.locator('[data-fp-tip="grow"]');
  await rest(page, row, tip);
  await expect(tip).toHaveText(FILES[2].path);
  await expect(row).toHaveAttribute('data-fp-tip-open');
  // Over the line: it starts where the text does.
  const [line, grown] = await Promise.all([row.locator('[data-elide]').first().boundingBox(), tip.boundingBox()]);
  expect(Math.abs(grown!.y + grown!.height / 2 - (line!.y + line!.height / 2))).toBeLessThan(line!.height);
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
});

test('the folder path peeks at what its ellipsis hides', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  const crumbs = page.getByTestId('breadcrumb');
  const tip = page.locator('[data-fp-tip="peek"]');
  await rest(page, crumbs.locator('[data-fp-ellipsis]').first(), tip);
  const hidden = (await tip.innerText()).trim();
  expect(hidden.length).toBeGreaterThan(3);
  expect(folderOf(PATH).split('/').join(' / ')).toContain(hidden);
});

for (const [kind, full] of [
  ['radix', PATH],
  ['base', LINK],
] as const) {
  test(`the ${kind === 'radix' ? 'Radix' : 'Base UI'} tooltip opens only while the text is cut`, async ({ page }) => {
    await page.goto('/');
    await hydrated(page);
    const content = page.locator('[data-slot="tooltip-content"]');
    await page.getByTestId(`${kind}-trigger`).first().hover();
    await expect(content).toBeVisible();
    await expect(content).toContainText(full);
    // In steps: Radix keeps a tip open while the pointer may be heading for it.
    await page.mouse.move(0, 0, { steps: 10 });
    await expect(content).toBeHidden();
    await page.getByTestId(`${kind}-trigger`).last().hover();
    // Longer than either tooltip's delay.
    await page.waitForTimeout(1000);
    await expect(content).toBeHidden();
  });
}
