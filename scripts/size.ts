// What each entry point costs an app that imports it alone: bundled from
// dist/ (run `bun run build` first), minified and gzipped, with React and
// React DOM left to the app. Fails when one grows past its budget. Raise a
// budget on purpose, in the same change that needs it.

/** Gzipped bytes each entry may take. */
const BUDGETS: Record<string, number> = {
  index: 22.75 * 1024,
  geometry: 2 * 1024,
  glyphs: 2.25 * 1024,
  changes: 2 * 1024,
  suffix: 0.75 * 1024,
  list: 1.75 * 1024,
  input: 24.5 * 1024,
  autosize: 0.5 * 1024,
  transitions: 6.5 * 1024,
  tooltip: 7 * 1024,
  text: 5.5 * 1024,
  element: 26 * 1024,
  react: 24.25 * 1024,
  vue: 23.25 * 1024,
  svelte: 23.25 * 1024,
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(2)} kB`;
let over = false;
for (const [entry, budget] of Object.entries(BUDGETS)) {
  const result = await Bun.build({ entrypoints: [`dist/${entry}.js`], minify: true, external: ['react', 'react-dom'], target: 'browser' });
  const output = result.outputs[0];
  if (!result.success || !output) throw new Error(`Could not bundle dist/${entry}.js: ${result.logs.map((log) => log.message).join('\n')}`);
  const size = Bun.gzipSync(await output.text()).length;
  const fits = size <= budget;
  over ||= !fits;
  console.log(`${fits ? 'ok  ' : 'OVER'} ${entry.padEnd(12)} ${kb(size).padStart(9)} / ${kb(budget)}`);
}
if (over) process.exit(1);
