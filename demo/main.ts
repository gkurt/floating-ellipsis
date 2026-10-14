import { type Elide, type Gap, elide, separators } from '../src/index.js';
import { type Effect, transitions } from '../src/transitions.js';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;

// ---------------------------------------------------------------------------
// Small UI helpers

/** Segmented control: calls back with the pressed button's value. */
function segmented(name: string, onPick: (value: string) => void) {
  const seg = $(`.seg[data-name="${name}"]`);
  seg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
    onPick(btn.value);
  });
}

/** Drag the box's handle to change its width. */
function resizable(box: HTMLElement, onDrag?: () => void) {
  const handle = $('.handle', box);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = box.getBoundingClientRect().width;
    const max = box.parentElement!.clientWidth - 64;
    onDrag?.();
    const move = (ev: PointerEvent) => {
      box.style.width = `${Math.max(80, Math.min(max, startW + ev.clientX - startX))}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 8;
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    onDrag?.();
    const max = box.parentElement!.clientWidth - 64;
    box.style.width = `${Math.max(80, Math.min(max, box.getBoundingClientRect().width + dir * step))}px`;
  });
}

/**
 * Draw the ink gaps on both sides of the ellipsis, plus the ellipsis' ink box.
 * Uses `ellipsisInk()` and `state.gap` from the instance.
 */
function drawGuides(instance: Elide, layer: HTMLElement) {
  const ink = instance.ellipsisInk();
  const gap = instance.state.gap;
  if (!ink || !gap) {
    if (layer.childElementCount) layer.replaceChildren();
    return;
  }
  const base = layer.getBoundingClientRect();
  const pad = Math.max(4, ink.height * 0.6);
  const top = ink.top - base.top - pad;
  const height = ink.height + pad * 2;
  const box = (cls: string, x: number, w: number, label?: string) => {
    const el = document.createElement('div');
    el.className = `guide ${cls}`;
    el.style.cssText = `left:${x - base.left}px;top:${top}px;width:${Math.max(0, w)}px;height:${height}px`;
    if (label) el.innerHTML = `<b>${label}</b>`;
    return el;
  };
  const parts = [box('ink', ink.left, ink.width)];
  if (gap.left !== null) parts.push(box('gap left', ink.left - gap.left, gap.left, gap.left.toFixed(1)));
  if (gap.right !== null) parts.push(box('gap right', ink.right, gap.right, gap.right.toFixed(1)));
  layer.replaceChildren(...parts);
}

// ---------------------------------------------------------------------------
// Playground

const heroBox = $('#heroBox');
const heroGuides = $('.guides', heroBox);
const hero = elide($('#hero'), { position: 0.5, lines: 1, glyphs: true, gap: 'dots' });
// Handy for poking at the API from the console.
Object.assign(window, { hero });

let stopTransitions: (() => void) | null = transitions(hero, { effect: 'merge' });
segmented('effect', (value) => {
  stopTransitions?.();
  stopTransitions = value === 'none' ? null : transitions(hero, { effect: value as Effect });
});

const pos = $<HTMLInputElement>('#pos');
pos.addEventListener('input', () => {
  $('#posOut').textContent = `${pos.value}%`;
  hero.update({ position: Number(pos.value) / 100 });
});
segmented('lines', (v) => hero.update({ lines: Number(v) }));
segmented('gap', (v) => hero.update({ gap: v as Gap }));
segmented('justify', (v) => hero.update({ justify: v === 'off' ? false : (v as 'ellipsis' | 'spread') }));

const showGuides = $<HTMLInputElement>('#showGuides');
showGuides.addEventListener('change', () => {
  if (!showGuides.checked) heroGuides.replaceChildren();
});

// Live readout of the instance state.
const readout = $('#readout');
let lastReadout = '';
function renderReadout() {
  const s = hero.state;
  const fmt = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(2)}px`);
  const rows: [string, string][] = [
    ['truncated', String(s.truncated)],
    ['visible', s.truncated ? `[0, ${s.start}) + [${s.end}, ${s.length})` : `all ${s.length}`],
    ['head', JSON.stringify(s.head.slice(-18))],
    ['omitted', JSON.stringify(s.omitted)],
    ['tail', JSON.stringify(s.tail.slice(0, 18))],
    ['lines', String(s.lines)],
    ['gap target', fmt(s.gap?.target)],
    ['natural gaps', s.gap ? `${fmt(s.gap.naturalLeft)} · ${fmt(s.gap.naturalRight)}` : '–'],
    ['final gaps', s.gap ? `${fmt(s.gap.left)} · ${fmt(s.gap.right)}` : '–'],
    ['slack', fmt(s.gap?.slack)],
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
renderReadout();

// Breathing: sweep the width back and forth.
const breathe = $<HTMLInputElement>('#breathe');
let phase = 0.62;
let last = 0;
function tick(now: number) {
  const dt = last ? Math.min(64, now - last) : 16;
  last = now;
  if (breathe.checked) {
    phase += dt / 7000;
    const max = heroBox.parentElement!.clientWidth - 64;
    const min = Math.min(260, max);
    const t = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    heroBox.style.width = `${min + (max - min) * t}px`;
  }
  if (showGuides.checked) drawGuides(hero, heroGuides);
  renderReadout();
  for (const [instance, layer] of compareGuides) drawGuides(instance, layer);
  requestAnimationFrame(tick);
}
resizable(heroBox, () => {
  breathe.checked = false;
});

// ---------------------------------------------------------------------------
// Balanced gaps: same text and width, naive vs balanced.

const samples: { text: string; cls?: string; position: number; width: string }[] = [
  { text: 'Wavering lightly over Avalon', position: 0.5, width: '82%' },
  { text: 'AVAILABILITY / TYPOGRAPHY', cls: 'caps', position: 0.42, width: '86%' },
  { text: 'fulfill(); flip().flop();', cls: 'mono', position: 0.5, width: '74%' },
];
const compareGuides: [Elide, HTMLElement][] = [];
const compare = $('#compare');
for (const sample of samples) {
  for (const gap of ['none', 'dots'] as const) {
    const cell = document.createElement('div');
    cell.className = 'compare-cell';
    const p = document.createElement('p');
    if (sample.cls) p.className = sample.cls;
    p.style.width = sample.width;
    p.textContent = sample.text;
    const layer = document.createElement('div');
    layer.className = 'guides';
    cell.append(p, layer);
    compare.append(cell);
    compareGuides.push([elide(p, { position: sample.position, gap, justify: false }), layer]);
  }
}

// ---------------------------------------------------------------------------
// Paths

const paths = [
  '/Users/ada/Projects/analytical-engine/src/notes/bernoulli-numbers.md',
  '/var/log/nginx/access.log.2026-10-14.gz',
  'C:\\Program Files\\Common Files\\Shared Tools\\Proofing\\en-US\\dictionary.lex',
  '/home/grace/compilers/a0/flowmatic/test/fixtures/payroll/october.cbl',
  '/opt/homebrew/Cellar/ffmpeg/8.0.1/share/ffmpeg/examples/transcode.c',
  'https://example.com/docs/guides/truncation/balanced-ellipsis#measuring-ink',
  '/srv/media/photos/2026/iceland/day-04/glacier-lagoon/IMG_4821.HEIC',
];
const fileIcon =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/></svg>';

const list = $('#files');
const pathInstances: Elide[] = [];
const snapPaths = separators('/\\');
const snap = $<HTMLInputElement>('#snap');
for (const path of paths) {
  const li = document.createElement('li');
  li.innerHTML = fileIcon;
  const span = document.createElement('span');
  span.className = 'path';
  span.textContent = path;
  li.append(span);
  list.append(li);
  pathInstances.push(elide(span, { position: 0.5, snap: snapPaths }));
}
Object.assign(window, { pathInstances });
snap.addEventListener('change', () => {
  for (const p of pathInstances) p.update({ snap: snap.checked ? snapPaths : null });
});

let reveal: 'expand' | 'peek' = 'expand';
const filesBox = $('#filesBox');
segmented('reveal', (v) => {
  reveal = v as typeof reveal;
  filesBox.classList.toggle('reveal-peek', reveal === 'peek');
  hideTips();
});
resizable(filesBox, hideTips);

const expandTip = $('#expandTip');
const peekTip = $('#peekTip');
function hideTips() {
  expandTip.hidden = true;
  peekTip.hidden = true;
}

/** Full text, laid exactly over the truncated text so the letters line up. */
function showExpand(instance: Elide) {
  if (!instance.truncated) return hideTips();
  const first = instance.lineRects()[0];
  if (!first) return;
  expandTip.textContent = instance.state.text;
  expandTip.hidden = false;
  const cs = getComputedStyle(expandTip);
  const lineHeight = parseFloat(cs.lineHeight);
  // The line rect is the font's content area; center it in the tip's line box.
  const x = first.left - parseFloat(cs.paddingLeft);
  const y = first.top - (lineHeight - first.height) / 2 - parseFloat(cs.paddingTop);
  expandTip.style.left = `${Math.round(x)}px`;
  expandTip.style.top = `${Math.round(y)}px`;
}

/** Only the omitted part, anchored to the ellipsis ink. */
function showPeek(instance: Elide) {
  const ink = instance.ellipsisInk();
  if (!ink) return hideTips();
  peekTip.textContent = instance.state.omitted;
  peekTip.hidden = false;
  peekTip.style.left = `${ink.left + ink.width / 2}px`;
  peekTip.style.top = `${ink.top - 12}px`;
}

list.addEventListener('pointerover', (e) => {
  const target = e.target as HTMLElement;
  const row = target.closest('li');
  const index = row ? Array.prototype.indexOf.call(list.children, row) : -1;
  const instance = pathInstances[index];
  if (!instance) return hideTips();
  if (reveal === 'expand') showExpand(instance);
  else if (target.closest('[data-fp-ellipsis]')) showPeek(instance);
  else hideTips();
});
list.addEventListener('pointerleave', hideTips);
window.addEventListener('scroll', hideTips, { passive: true });

// ---------------------------------------------------------------------------
// Multi-line

const article = elide($('#article'), { lines: 3, position: 0.7 });
const mpos = $<HTMLInputElement>('#mpos');
mpos.addEventListener('input', () => {
  $('#mposOut').textContent = `${mpos.value}%`;
  article.update({ position: Number(mpos.value) / 100 });
});
segmented('mlines', (v) => article.update({ lines: Number(v) }));
resizable($('#cardBox'));

requestAnimationFrame(tick);
