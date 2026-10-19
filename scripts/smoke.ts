// The package as npm will get it, used as a consumer would. It's built and
// packed as the release does (the publish scripts, then `bun pm pack`, as
// Tegami publishes with bun), installed with npm into the app in test/smoke,
// copied outside the repo, then imported in Node without a DOM,
// type-checked as Node and as bundlers resolve it, bundled by Vite, and
// opened in Chromium. The release waits for it.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { $ } from 'bun';
import { chromium } from 'playwright';
import pkg from '#package.json' with { type: 'json' };

const root = join(import.meta.dir, '..');
const dir = await mkdtemp(join(tmpdir(), 'floating-ellipsis-smoke-'));
const app = join(dir, 'app');
const tarball = join(dir, 'pkg.tgz');
const step = (what: string) => console.log(`\n== ${what}`);
let passed = false;

// The consumer's commands run on Node, not on the Bun that `bun run` puts
// first on PATH as `node` (bunfig.toml's `[run] bun = true`).
const env: Record<string, string | undefined> = {};
for (const [key, value] of Object.entries(process.env)) if (key.toLowerCase() !== 'path') env[key] = value;
env.PATH = (process.env.PATH ?? '')
  .split(delimiter)
  .filter((entry) => !/[\\/]bun-node-[^\\/]*$/.test(entry))
  .join(delimiter);
const consumer = (strings: TemplateStringsArray, ...values: string[]) =>
  $(strings, ...values)
    .cwd(app)
    .env(env);

try {
  step('pack, as the release does');
  const scripts: Record<string, string> = pkg.scripts;
  for (const script of ['prepublishOnly', 'prepack', 'prepare']) if (scripts[script]) await $`bun run ${script}`.cwd(root);
  await $`bun pm pack --filename ${tarball}`.cwd(root);

  step('install with npm, outside the repo');
  await cp(join(root, 'test/smoke'), app, { recursive: true });
  const dev: Record<string, string> = pkg.devDependencies;
  const manifest = {
    name: 'floating-ellipsis-smoke',
    private: true,
    type: 'module',
    dependencies: { 'floating-ellipsis': `file:${tarball}`, react: dev.react, 'react-dom': dev['react-dom'] },
    devDependencies: {
      '@types/react': dev['@types/react'],
      '@types/react-dom': dev['@types/react-dom'],
      typescript: dev.typescript,
      vite: dev.vite,
    },
  };
  await writeFile(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const node = (await consumer`node -p ${'process.versions.bun ? "bun" : process.version'}`.text()).trim();
  if (!/^v\d/.test(node)) throw new Error(`The smoke test needs Node on PATH, found ${node}`);
  console.log(`node ${node}, npm ${(await consumer`npm --version`.text()).trim()}`);
  await consumer`npm install --no-audit --no-fund`;

  step('import every entry in Node, without a DOM');
  await consumer`node server.mjs`;

  step('type-check, as Node and as bundlers resolve it');
  const installed: { exports: object } = JSON.parse(await readFile(join(app, 'node_modules/floating-ellipsis/package.json'), 'utf8'));
  const entries = Object.keys(installed.exports)
    .filter((entry) => !entry.endsWith('.css'))
    .map((entry, i) => `export * as entry${i} from 'floating-ellipsis${entry.slice(1)}';`);
  await writeFile(join(app, 'entries.ts'), `${entries.join('\n')}\n`);
  await consumer`npx tsc -p tsconfig.json`;
  await consumer`npx tsc -p tsconfig.bundler.json`;

  step('bundle with Vite');
  await consumer`npx vite build --logLevel warn`;

  step('open in Chromium');
  await inBrowser(join(app, 'dist'));
  passed = true;
  console.log('\nThe packed package works as a consumer uses it.');
} finally {
  if (passed) await rm(dir, { recursive: true, force: true });
  else console.error(`\nLeft the app in ${app}`);
}

/** Serve the built app and check that each way of using the library cut its line, with no errors. */
async function inBrowser(site: string) {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const file = Bun.file(join(site, path === '/' ? 'index.html' : path));
      return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 });
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(server.url.href);
    await page.waitForFunction(() => document.querySelectorAll('[data-elide][data-truncated]').length === 3, null, { timeout: 10_000 });
    const problems = await page.evaluate(() => {
      const found: string[] = [];
      for (const selector of ['#core', '#element', '#react > [data-elide]']) {
        const el = document.querySelector(selector)!;
        const box = el.getBoundingClientRect();
        const text = el.querySelector('[data-fp-text]')?.getBoundingClientRect();
        if (!el.querySelector('[data-fp-ellipsis]')) found.push(`${selector} shows no ellipsis`);
        if (!text || text.right > box.right + 0.5) found.push(`${selector}'s text runs past its box`);
        if (box.height > 21) found.push(`${selector} takes ${box.height}px, more than a line`);
      }
      const fallback = document.querySelector<HTMLElement>('#fallback')!;
      if (getComputedStyle(fallback).textOverflow !== 'ellipsis') found.push('fallback.css is not applied');
      return found;
    });
    problems.push(...errors.map((error) => `page error: ${error}`));
    if (problems.length > 0) throw new Error(`In the browser:\n${problems.join('\n')}`);
    console.log('browser: the core, <elide-text> and <Elided> cut their lines, and fallback.css applies');
  } finally {
    await browser.close();
    await server.stop();
  }
}
