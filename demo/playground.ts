/// <reference types="vite/client" />
import { createDialKit, createDialRoot } from 'dialkit/vanilla';
import 'dialkit/vanilla/styles.css';
import { ellipsisInk, markInks } from '#src/geometry.ts';
import { glyphs } from '#src/glyphs.ts';
import { type Elide, type ElideOptions, type EllipsisStyle, type Gap, elide, words } from '#src/index.ts';
import { type Effect, transitions } from '#src/transitions.ts';
import { $, resizable } from './ui.ts';

// One floating panel holds the dials; on a phone it starts closed.
createDialRoot({ position: 'top-right', defaultOpen: !matchMedia('(max-width: 720px)').matches, theme: 'system' });

/**
 * Draw the ink gaps around and inside every ellipsis, plus the ink of each
 * mark. Uses `marks()` and `state.gaps` from the instance.
 */
function drawGuides(instance: Elide, layer: HTMLElement) {
  const { gaps } = instance.state;
  const parts: HTMLElement[] = [];
  const base = layer.getBoundingClientRect();
  gaps.forEach((gap, j) => {
    const marks = markInks(instance, j);
    const ink = ellipsisInk(instance, j);
    if (!ink || marks.length === 0) return;
    const pad = Math.max(4, ink.height * 0.8);
    const top = ink.top - base.top - pad;
    const height = ink.height + pad * 2;
    const box = (cls: string, x: number, w: number, label?: string) => {
      const el = document.createElement('div');
      el.className = `guide ${cls}`;
      el.style.cssText = `left:${x - base.left}px;top:${top}px;width:${Math.max(0, w)}px;height:${height}px`;
      if (label) el.innerHTML = `<b>${label}</b>`;
      parts.push(el);
    };
    for (const m of marks) box('ink', m.left, m.width);
    if (gap.left !== null) box('gap left', ink.left - gap.left, gap.left, gap.left.toFixed(1));
    marks.slice(1).forEach((m, i) => box('gap inner', marks[i]!.right, m.left - marks[i]!.right));
    if (gap.right !== null) box('gap right', ink.right, gap.right, gap.right.toFixed(1));
  });
  layer.replaceChildren(...parts);
}

// ---------------------------------------------------------------------------
// Playground

const heroBox = $('#heroBox');
const heroGuides = $('.guides', heroBox);
const hero = elide($('#hero'), { position: 0.5, lines: 1, glyphs });
// Handy for poking at the API from the console.
Object.assign(window, { hero });

// Breathing: sweep the width back and forth. Frames only run while it
// breathes or the guides are on (they follow the dots as they glide).
let phase = 0.62;
let last = 0;
let frame = 0;

/** Keep visible: comma-separated words, or /regex/flags. Parts that aren't valid are left out. */
function parseKeep(value: string): (string | RegExp)[] {
  return value.split(',').flatMap<string | RegExp>((raw) => {
    const part = raw.trim();
    const re = /^\/(.+)\/([dgimsuvy]*)$/.exec(part);
    if (!re) return part ? [part] : [];
    try {
      return [new RegExp(re[1]!, re[2])];
    } catch {
      return [];
    }
  });
}

/** The font's own '…' is three dots; any other count draws dots shaped like its own. */
function ellipsisStyle(kind: string, n: number): EllipsisStyle {
  if (kind === 'glyph') return n === 3 ? '…' : { shape: 'dot', like: '…', count: n };
  if (kind === 'periods') return '.'.repeat(n);
  return { shape: kind as 'dot' | 'bullet' | 'ring' | 'square', count: n };
}

const byWords = words();
// Registered first, so the panel shows them at the top.
const viewDials = createDialKit('View', {
  breathe: false,
  inkGuides: true,
  transition: { type: 'select', options: ['merge', 'fade', 'blur', 'none'], default: 'merge' },
});
let stopTransitions: () => void = () => {};
let effect = '';
viewDials.subscribe(({ inkGuides, transition }) => {
  if (!inkGuides) heroGuides.replaceChildren();
  animate();
  if (transition === effect) return;
  effect = transition;
  stopTransitions();
  // With no glyph effect the dots still glide.
  stopTransitions = transitions(hero, { effect: transition as Effect });
});

const heroText = $('#hero').textContent;
const textDials = createDialKit('Text', {
  text: { type: 'text', default: heroText, placeholder: 'Type something long' },
  position: [0.5, 0, 1, 0.01],
  lines: [1, 1, 3, 1],
  keep: { type: 'text', default: '', placeholder: 'quiet, asked or /\\w+ly/g' },
  cutAt: {
    type: 'select',
    options: [
      { value: 'glyph', label: 'any glyph' },
      { value: 'words', label: 'whole words' },
    ],
    default: 'glyph',
  },
});
const ellipsisDials = createDialKit('Ellipsis', {
  style: {
    type: 'select',
    options: [{ value: 'glyph', label: '… (the font’s)' }, { value: 'periods', label: '... (periods)' }, 'dot', 'bullet', 'ring', 'square'],
    default: 'glyph',
  },
  dots: [3, 0, 7, 1],
  gap: { type: 'select', options: ['dots', 'natural', 'none'], default: 'dots' },
  justify: { type: 'select', options: ['dots', 'ellipsis', 'spread', 'off'], default: 'dots' },
  repeat: [0.75, 0, 1, 0.05],
});

function update() {
  const { text, position, lines, keep, cutAt } = textDials.values;
  const { style, dots, gap, justify, repeat } = ellipsisDials.values;
  hero.update({
    text,
    position,
    lines,
    keep: parseKeep(keep),
    ellipsis: ellipsisStyle(style, dots),
    gap: gap as Gap,
    justify: justify === 'off' ? false : (justify as ElideOptions['justify']),
    repeat,
    snap: cutAt === 'words' ? byWords : null,
  });
}
textDials.subscribe(update, false);
ellipsisDials.subscribe(update);

// Live readout of the instance state.
const readout = $('#readout');
let lastReadout = '';
function renderReadout() {
  const s = hero.state;
  const px = (v: number | null | undefined) => (v == null ? '–' : v.toFixed(2));
  const g = s.gaps[0];
  const rows: [string, string][] = [
    ['truncated', String(s.truncated)],
    ['hidden', s.hidden.length > 0 ? s.hidden.map((h) => `[${h.start}, ${h.end})`).join(' ') : '–'],
    ['omitted', s.hidden.length > 0 ? JSON.stringify(s.hidden.map((h) => h.text).join(' | ')) : '–'],
    ['lines', String(s.lines)],
    ['gap target', g ? px(g.target) : '–'],
    ['natural gaps', g ? `${px(g.naturalLeft)} · ${px(g.naturalRight)}` : '–'],
    ['final gaps', g ? [g.left, ...g.inner, g.right].map(px).join(' · ') : '–'],
    ['slack', `${px(s.slack)} (room before justify)`],
  ];
  const key = rows.join('|');
  if (key === lastReadout) return;
  lastReadout = key;
  readout.replaceChildren(
    ...rows.map(([k, v]) => {
      const div = document.createElement('div');
      div.innerHTML = '<dt></dt><dd></dd>';
      div.firstElementChild!.textContent = k;
      div.lastElementChild!.textContent = v;
      div.lastElementChild!.setAttribute('title', v);
      return div;
    }),
  );
}
hero.onRender(renderReadout);
renderReadout();

function tick(now: number) {
  frame = 0;
  const dt = last !== 0 ? Math.min(64, now - last) : 16;
  last = now;
  const { breathe, inkGuides } = viewDials.values;
  if (breathe) {
    phase += dt / 7000;
    const max = heroBox.parentElement!.clientWidth - 64;
    const min = Math.min(260, max);
    const t = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    heroBox.style.width = `${min + (max - min) * t}px`;
  }
  if (inkGuides) drawGuides(hero, heroGuides);
  if (breathe || inkGuides) frame = requestAnimationFrame(tick);
  else last = 0;
}
function animate() {
  frame ||= requestAnimationFrame(tick);
}
resizable(heroBox, () => viewDials.setValue('breathe', false));

animate();
