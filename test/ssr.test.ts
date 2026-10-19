// Server rendering, where there is no DOM: Bun runs these without one.
import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import pkg from '#package.json' with { type: 'json' };
import { dateForms } from '#src/dates.ts';
import { define } from '#src/element.ts';
import { Elided, useElide } from '#src/react.ts';

const PATH = '/Users/ada/Projects/analytical-engine/notes/2026/difference-tables.md';

describe('without a DOM', () => {
  it('has none', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof HTMLElement).toBe('undefined');
  });

  it('imports every entry', async () => {
    const sources = Object.values(pkg.exports).flatMap((e) => (typeof e === 'string' ? [] : [e.source]));
    expect(sources.length).toBeGreaterThan(10);
    for (const source of sources) expect(await import(`#${source.slice(2)}`)).toBeObject();
  });

  it('defines no custom element', () => {
    expect(() => define()).not.toThrow();
  });
});

describe('Elided on the server', () => {
  it('renders its text for fallback.css, without options as attributes', () => {
    const html = renderToString(
      createElement(Elided, { text: PATH, position: 'middle', keep: /\.md$/, lines: 1, className: 'path', title: false, id: 'p' }),
    );
    expect(html).toBe(`<div class="path" id="p" data-elide-fallback="">${PATH}</div>`);
  });

  it('marks how many lines to clamp, in the element it is told to be', () => {
    const html = renderToString(createElement(Elided, { text: 'A note', as: 'p', lines: 3 }));
    expect(html).toBe('<p data-elide-fallback="3">A note</p>');
  });

  it('renders dates written out in full, their short forms as options', () => {
    const date = dateForms(Date.UTC(2026, 9, 14), { locale: 'en-US', timeZone: 'UTC' });
    const html = renderToString(createElement(Elided, { ...date, className: 'when' }));
    expect(html).toBe('<div class="when" data-elide-fallback="">Wednesday, October 14, 2026</div>');
  });

  it('escapes its text', () => {
    const html = renderToString(createElement(Elided, { text: '<b>&amp;</b>' }));
    expect(html).toContain('&lt;b&gt;&amp;amp;&lt;/b&gt;');
  });

  it('prerenders, as static generation does', async () => {
    const { prelude } = await prerender(createElement(Elided, { text: PATH, position: 'middle' }));
    expect(await new Response(prelude).text()).toContain(`data-elide-fallback="">${PATH}</div>`);
  });
});

describe('useElide on the server', () => {
  it('renders the element empty, with no instance', () => {
    function Path() {
      const [ref, t] = useElide<HTMLDivElement>({ text: PATH });
      return createElement('div', { ref, className: 'path', 'data-instance': t === null ? 'none' : 'made' });
    }
    expect(renderToString(createElement(Path))).toBe('<div class="path" data-instance="none"></div>');
  });
});
