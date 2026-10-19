// A consumer on the server: Node, no DOM, the package as npm installed it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const manifest = JSON.parse(await readFile('node_modules/floating-ellipsis/package.json', 'utf8'));

for (const entry of Object.keys(manifest.exports)) {
  const name = `floating-ellipsis${entry.slice(1)}`;
  if (entry.endsWith('.css')) {
    assert.match(await readFile(new URL(import.meta.resolve(name)), 'utf8'), /data-elide-fallback/, `${name} is empty`);
    continue;
  }
  const module = await import(name);
  assert.ok(Object.keys(module).length > 0, `${name} exports nothing`);
}

const { elideText } = await import('floating-ellipsis/text');
const mono = (text) => [...text].length * 10;
const cut = elideText('/Users/ada/notes/2026/difference-tables.md', { width: 200, measure: mono, position: 'middle' });
assert.equal(cut.truncated, true);
assert.ok(cut.width <= 200, `elideText is ${cut.width} wide in 200`);
assert.match(cut.text, /^\/Users.*….*\.md$/);

const { Elided } = await import('floating-ellipsis/react');
assert.equal(renderToString(createElement(Elided, { text: 'A note', as: 'p', lines: 3 })), '<p data-elide-fallback="3">A note</p>');

const { dateForms } = await import('floating-ellipsis/dates');
const date = dateForms(Date.UTC(2026, 9, 14), { locale: 'en-US', timeZone: 'UTC' });
assert.equal(date.text, 'Wednesday, October 14, 2026');

const { define } = await import('floating-ellipsis/element');
assert.doesNotThrow(() => define());

console.log(`server: ${Object.keys(manifest.exports).length} entries import without a DOM`);
