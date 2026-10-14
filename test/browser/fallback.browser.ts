import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { define } from '#src/element.ts';
import { Elided } from '#src/react.ts';
import { PATH, PROSE, box, make, track } from './helpers.ts';

beforeAll(async () => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../src/fallback.css', import.meta.url).href;
  const loaded = new Promise((resolve) => link.addEventListener('load', resolve));
  document.head.append(link);
  await loaded;
});

const style = (el: Element) => getComputedStyle(el);

describe('fallback.css', () => {
  it('truncates with plain CSS until an instance takes over', () => {
    const el = box(PROSE);
    el.setAttribute('data-elide-fallback', '');
    expect(style(el).textOverflow).toBe('ellipsis');
    expect(style(el).whiteSpace).toBe('nowrap');
    const t = make(el, { position: 'middle' });
    expect(el.hasAttribute('data-elide')).toBe(true);
    expect(style(el).textOverflow).toBe('clip');
    expect(t.truncated).toBe(true);
    t.destroy();
    expect(el.hasAttribute('data-elide')).toBe(false);
    expect(style(el).textOverflow).toBe('ellipsis');
  });

  it('clamps several lines', () => {
    const el = box(PROSE);
    el.setAttribute('data-elide-fallback', '3');
    expect(style(el).getPropertyValue('-webkit-line-clamp')).toBe('3');
    make(el, { lines: 3 });
    expect(style(el).getPropertyValue('-webkit-line-clamp')).not.toBe('3');
  });

  it('truncates <elide-text> until it is defined', () => {
    const host = box('', 'width:auto');
    host.innerHTML = `<elide-text style="width:200px" position="middle">${PATH}</elide-text>`;
    const el = host.firstElementChild!;
    expect(style(el).textOverflow).toBe('ellipsis');
    define();
    expect(el.hasAttribute('data-elide')).toBe(true);
    expect(style(el).textOverflow).toBe('clip');
  });
});

describe('server-rendered React', () => {
  it('shows the text truncated by CSS, then hydrates into an instance', async () => {
    const element = createElement(Elided, { text: PATH, position: 'middle', lines: 2, style: { width: 120 }, className: 'path' });
    const html = renderToString(element);
    expect(html).toContain('data-elide-fallback="2"');
    expect(html).toContain(PATH);

    const container = track(document.createElement('div'));
    container.innerHTML = html;
    document.body.append(container);
    const el = container.querySelector<HTMLElement>('.path')!;
    expect(style(el).getPropertyValue('-webkit-line-clamp')).toBe('2');

    const errors: unknown[] = [];
    const root = hydrateRoot(container, element, { onRecoverableError: (e) => errors.push(e) });
    // Hydrating is scheduled; it commits when React gets to it.
    await expect.poll(() => el.hasAttribute('data-truncated')).toBe(true);
    expect(errors).toEqual([]);
    expect(el.isConnected).toBe(true);
    expect(el.hasAttribute('data-elide')).toBe(true);
    root.unmount();
  });
});
