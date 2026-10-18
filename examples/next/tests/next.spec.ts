import { type Page, expect, test } from '@playwright/test';
import { FILES, PATH, SHORT } from '@/lib/files';

const REQUESTED = '/srv/www/releases/2026-10-18/build-artifacts/floating-ellipsis/coverage/report.html';
const PAGES = [
  { name: 'static', url: '/', path: PATH },
  { name: 'dynamic', url: `/ssr?path=${encodeURIComponent(REQUESTED)}`, path: REQUESTED },
];
// The button's text, two tooltip triggers of each kind, and two cells in each row.
const INSTANCES = 1 + 4 + 2 * FILES.length;

/** What the page logs as errors and warnings, React's hydration mismatches among them. */
function problems(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') seen.push(m.text());
  });
  page.on('pageerror', (e) => seen.push(e.message));
  return seen;
}

/** Until every instance has taken its element over from fallback.css. */
async function hydrated(page: Page, count: number) {
  await expect(page.locator('[data-elide]')).toHaveCount(count);
  await expect(page.locator('[data-elide-fallback]:not([data-elide])')).toHaveCount(0);
}

/** The text of every element whose content is wider than its box. */
const overflowing = (page: Page) =>
  page.$$eval('[data-elide-fallback]', (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));

/** What the button shows: its line, without the screen-reader copy. */
const shown = (page: Page) => page.getByTestId('file-button').locator('[data-elide]').innerText();

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
      await hydrated(page, INSTANCES + (name === 'dynamic' ? 2 : 0));
      expect(await overflowing(page)).toEqual([]);
      await expect(page.getByTestId('radix-trigger').first()).toHaveAttribute('data-truncated');
      await expect(page.getByTestId('radix-trigger').last()).not.toHaveAttribute('data-truncated');
      const text = await shown(page);
      expect(text.length).toBeLessThan(path.length);
      expect(path.startsWith(text.slice(0, 5))).toBe(true);
      expect(text.endsWith(path.slice(path.lastIndexOf('/') + 1))).toBe(true);
      expect(logged).toEqual([]);
    });

    test('refits when the box narrows', async ({ page }) => {
      await page.goto(url);
      await hydrated(page, INSTANCES + (name === 'dynamic' ? 2 : 0));
      const cell = page.getByTestId('files-table').locator('[data-elide]').first();
      const before = (await cell.innerText()).length;
      await page.setViewportSize({ width: 480, height: 720 });
      await expect.poll(async () => (await cell.innerText()).length).toBeLessThan(before);
      expect(await overflowing(page)).toEqual([]);
    });
  });
}

for (const kind of ['radix', 'base']) {
  test(`the ${kind === 'radix' ? 'Radix' : 'Base UI'} tooltip opens only while the text is cut`, async ({ page }) => {
    await page.goto('/');
    await hydrated(page, INSTANCES);
    const content = page.locator('[data-slot="tooltip-content"]');
    await page.getByTestId(`${kind}-trigger`).first().hover();
    await expect(content).toBeVisible();
    await expect(content).toContainText(PATH);
    // In steps: Radix keeps a tip open while the pointer may be heading for it.
    await page.mouse.move(0, 0, { steps: 10 });
    await expect(content).toBeHidden();
    await page.getByTestId(`${kind}-trigger`).last().hover();
    // Longer than either tooltip's delay.
    await page.waitForTimeout(1000);
    await expect(content).toBeHidden();
  });
}
