// What each entry point costs an app that imports it alone: bundled from
// dist/ (run `bun run build` first), minified and gzipped, with React left to
// the app. Fails when one grows past its budget. Raise a budget on purpose,
// in the same change that needs it.

/** Gzipped bytes each entry may take. */
const BUDGETS: Record<string, number> = {
  index: 20.5 * 1024,
  transitions: 4.25 * 1024,
  tooltip: 5.75 * 1024,
  text: 4 * 1024,
  element: 22 * 1024,
  react: 20.25 * 1024,
  vue: 20 * 1024,
  svelte: 20 * 1024,
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(2)} kB`;
let over = false;
for (const [entry, budget] of Object.entries(BUDGETS)) {
  const result = await Bun.build({ entrypoints: [`dist/${entry}.js`], minify: true, external: ['react'], target: 'browser' });
  const output = result.outputs[0];
  if (!result.success || !output) throw new Error(`Could not bundle dist/${entry}.js: ${result.logs.map((log) => log.message).join('\n')}`);
  const size = Bun.gzipSync(await output.text()).length;
  const fits = size <= budget;
  over ||= !fits;
  console.log(`${fits ? 'ok  ' : 'OVER'} ${entry.padEnd(12)} ${kb(size).padStart(9)} / ${kb(budget)}`);
}
if (over) process.exit(1);
