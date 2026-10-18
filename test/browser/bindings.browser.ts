import { type Ref, createElement, createRef, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, withDirectives } from 'vue';
import { ElideElement, define } from '#src/element.ts';
import type { Elide } from '#src/elide.ts';
import { Elided, useElide } from '#src/react.ts';
import { elide as action } from '#src/svelte.ts';
import { elideText } from '#src/text.ts';
import { elideOf, vElide } from '#src/vue.ts';
import { FONTS, PATH, PROSE, box, frames, rendered, spoken, track } from './helpers.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});

/** The hidden part's text for each ellipsis, or [] when nothing's cut. */
const cut = (t: Elide | null) => t?.state.hidden.map((p) => p.text) ?? [];

describe('<elide-text>', () => {
  define();

  function make(html: string): ElideElement {
    const host = box('', 'width:auto');
    host.innerHTML = html;
    const el = host.firstElementChild;
    if (!(el instanceof ElideElement)) throw new Error('not upgraded');
    return el;
  }

  it('truncates its text, configured by attributes', () => {
    const el = make(`<elide-text position="middle" keep="/\\.[^.]+$/" style="width:200px">${PATH}</elide-text>`);
    expect(getComputedStyle(el).display).toBe('block');
    expect(el.instance!.truncated).toBe(true);
    expect(rendered(el.instance!).endsWith('.md')).toBe(true);
    expect(el.text).toBe(PATH);
  });

  it('highlights what it keeps with keep-class', () => {
    const el = make(`<elide-text position="middle" keep="/engine/" keep-class="hit" style="width:200px">${PATH}</elide-text>`);
    expect(el.instance!.truncated).toBe(true);
    const hits = [...el.querySelectorAll('[data-fp-text] .hit')].map((e) => e.textContent).join('');
    expect(hits).toBe('engine');
  });

  it('follows attribute and property changes', () => {
    const el = make(`<elide-text style="width:200px">${PROSE}</elide-text>`);
    expect(el.instance!.state.hidden[0]!.end).toBe(el.instance!.state.length);
    el.setAttribute('position', 'start');
    expect(el.instance!.state.hidden[0]!.start).toBe(0);
    el.setAttribute('position', '0.33 0.67');
    expect(el.instance!.state.hidden).toHaveLength(2);
    el.removeAttribute('position');
    expect(el.instance!.state.hidden[0]!.end).toBe(el.instance!.state.length);
    el.text = 'Short';
    expect(el.instance!.truncated).toBe(false);
    el.options = { text: PATH, position: 'middle' };
    expect(el.instance!.state.text).toBe(PATH);
    expect(el.instance!.state.hidden[0]!.start).toBeGreaterThan(0);
  });

  it('snaps to words and paths', () => {
    const el = make(`<elide-text snap="words" position="middle" style="width:200px">${PROSE}</elide-text>`);
    for (const side of rendered(el.instance!).split(/\s+/)) expect(PROSE.split(' ')).toContain(side);
    el.setAttribute('snap', 'paths');
    el.text = PATH;
    expect(el.instance!.truncated).toBe(true);
    // The cut starts at a segment.
    const { graphemes, state } = el.instance!;
    expect(graphemes[state.hidden[0]!.start - 1]).toBe('/');
  });

  it('fires elidechange, and restores its content when removed', async () => {
    const el = make(`<elide-text style="width:120px">${PROSE}</elide-text>`);
    const seen: string[] = [];
    el.addEventListener('elidechange', (e) => e instanceof CustomEvent && seen.push(String(e.detail.reason)));
    await frames(1);
    el.setAttribute('position', 'middle');
    expect(el.instance!.truncated).toBe(true);
    expect(seen).toContain('update');
    el.remove();
    expect(el.textContent).toBe(PROSE);
    expect(el.instance).toBeNull();
  });
});

describe('React', () => {
  function mount(): { root: Root; container: HTMLElement } {
    const container = box('', 'width:auto');
    const root = createRoot(container);
    cleanups.push(() => root.unmount());
    return { root, container };
  }

  it('Elided renders an element showing its text, truncated', async () => {
    const { root, container } = mount();
    flushSync(() => root.render(createElement(Elided, { text: PATH, position: 'middle', className: 'path', style: { width: 200 } })));
    await frames(1);
    const el = container.querySelector<HTMLElement>('.path')!;
    expect(el.tagName).toBe('DIV');
    expect(el.hasAttribute('data-truncated')).toBe(true);
    expect(spoken(el)).toBe(PATH);
    flushSync(() =>
      root.render(createElement(Elided, { text: 'Short', as: 'span', className: 'path', style: { width: 200, display: 'block' } })),
    );
    await frames(1);
    expect(container.querySelector('span.path')!.textContent).toContain('Short');
  });

  it('Elided hands its element to a ref, as asChild and render props pass', async () => {
    const { root, container } = mount();
    const object = createRef<HTMLElement>();
    const render = (ref: Ref<HTMLElement>) =>
      flushSync(() =>
        root.render(createElement(Elided, { ref, text: PATH, position: 'middle', className: 'path', style: { width: 200 } })),
      );
    render(object);
    const el = container.querySelector<HTMLElement>('.path')!;
    expect(object.current).toBe(el);
    const line = el.querySelector('[data-fp-text]');
    expect(line).not.toBeNull();
    // A new callback each render, as a parent composing refs inline gives.
    const seen: (HTMLElement | null)[] = [];
    for (let i = 0; i < 3; i++) render((e) => void seen.push(e));
    await frames(1);
    expect(seen.filter(Boolean).every((e) => e === el)).toBe(true);
    expect(el.querySelector('[data-fp-text]')).toBe(line);
    expect(el.hasAttribute('data-truncated')).toBe(true);
  });

  it('useElide keeps the instance in step, and only updates on real changes', async () => {
    const { root } = mount();
    let instance: Elide | null = null;
    let changeText: (text: string) => void = () => {};
    let changes = 0;
    const onChange = () => changes++;
    function Path({ report }: { report: (t: Elide | null, set: (text: string) => void) => void }) {
      const [text, setText] = useState(PATH);
      // Inline options, new objects on every render.
      const [ref, t] = useElide<HTMLDivElement>({ text, position: 'middle', keep: [/\.[^.]+$/], onChange });
      // Hands the test what it drives the component with.
      useEffect(() => report(t, setText), [report, t]);
      return createElement('div', { ref, style: { width: 200 } });
    }
    const report = (t: Elide | null, set: (text: string) => void) => {
      instance = t;
      changeText = set;
    };
    flushSync(() => root.render(createElement(Path, { report })));
    flushSync(() => root.render(createElement(Path, { report })));
    const t = instance as Elide | null;
    expect(t?.truncated).toBe(true);
    await frames(1);
    let renders = 0;
    t!.onRender(() => renders++);
    flushSync(() => root.render(createElement(Path, { report })));
    await frames(1);
    expect(renders).toBe(0);
    flushSync(() => changeText('/a/b.md'));
    expect(t!.truncated).toBe(false);
    expect(changes).toBeGreaterThan(0);
  });
});

describe('Vue', () => {
  it('v-elide truncates, follows its value, and lets go on unmount', async () => {
    const text = ref(PATH);
    const container = box('', 'width:auto');
    const app = createApp({
      setup: () => () =>
        withDirectives(h('div', { class: 'path', style: { width: '200px' } }), [[vElide, { text: text.value, position: 'middle' }]]),
    });
    app.mount(container);
    const el = container.querySelector<HTMLElement>('.path')!;
    expect(cut(elideOf(el))).toHaveLength(1);
    text.value = 'Short';
    await nextTick();
    expect(elideOf(el)!.truncated).toBe(false);
    app.unmount();
    expect(elideOf(el)).toBeNull();
  });
});

describe('Svelte', () => {
  it('the elide action truncates, updates and lets go', async () => {
    const el = box('');
    const handle = action(el, { text: PROSE, position: 'middle' });
    await frames(1);
    expect(el.hasAttribute('data-truncated')).toBe(true);
    handle.update({ text: 'Short' });
    await frames(1);
    expect(el.hasAttribute('data-truncated')).toBe(false);
    handle.destroy();
    expect(el.childNodes).toHaveLength(0);
  });
});

describe('elideText', () => {
  it.each(FONTS)('fits what a %s line shows', (font) => {
    for (const position of ['start', 'middle', 'end'] as const) {
      for (let width = 60; width < 500; width += 37) {
        const r = elideText(PROSE, { width, font: font.replace(/\/\S+/, ''), position });
        const line = track(document.createElement('span'));
        line.style.cssText = `font:${font};white-space:pre;position:absolute`;
        line.textContent = r.text;
        document.body.append(line);
        expect(line.getBoundingClientRect().width).toBeLessThanOrEqual(width + 0.5);
        expect(r.width).toBeCloseTo(line.getBoundingClientRect().width, 0);
      }
    }
  });
});
