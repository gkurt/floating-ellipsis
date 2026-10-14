import { type Elide, type EllipsisStyle, type Gap, elide, separators } from '../src/index.js';
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

/** Drag the box's handle (or use arrow keys on it) to change its width. */
function resizable(box: HTMLElement, onResize?: () => void) {
  const handle = $('.handle', box);
  const setWidth = (w: number) => {
    const max = box.parentElement!.clientWidth - 64;
    box.style.width = `${Math.max(80, Math.min(max, w))}px`;
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = box.getBoundingClientRect().width;
    onResize?.();
    const move = (ev: PointerEvent) => setWidth(startW + ev.clientX - startX);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    onResize?.();
    setWidth(box.getBoundingClientRect().width + dir * (e.shiftKey ? 40 : 8));
  });
}

/**
 * Draw the ink gaps around and inside every ellipsis, plus the ink of each
 * mark. Uses `marks()` and `state.gaps` from the instance.
 */
function drawGuides(instance: Elide, layer: HTMLElement) {
  const { gaps } = instance.state;
  const parts: HTMLElement[] = [];
  const base = layer.getBoundingClientRect();
  gaps.forEach((gap, j) => {
    const marks = instance.marks(j);
    const ink = instance.ellipsisInk(j);
    if (!ink || !marks.length) return;
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
const hero = elide($('#hero'), { position: 0.5, lines: 1, glyphs: true });
// Handy for poking at the API from the console.
Object.assign(window, { hero });

const motion: { effect: Effect | 'none'; pace: 'leeway' | 'fixed'; marks: 'together' | 'after' } = {
  effect: 'merge',
  pace: 'leeway',
  marks: 'together',
};
let stopTransitions: () => void = () => {};
function restartTransitions() {
  stopTransitions();
  const { effect, pace, marks } = motion;
  // With no glyph effect the dots still glide.
  stopTransitions = transitions(hero, { effect, pace, marks });
}
restartTransitions();
segmented('effect', (v) => {
  motion.effect = v as typeof motion.effect;
  restartTransitions();
});
segmented('pace', (v) => {
  motion.pace = v as typeof motion.pace;
  restartTransitions();
});
segmented('marks', (v) => {
  motion.marks = v as typeof motion.marks;
  restartTransitions();
});

const pos = $<HTMLInputElement>('#pos');
pos.addEventListener('input', () => {
  $('#posOut').textContent = `${pos.value}%`;
  hero.update({ position: Number(pos.value) / 100 });
});
segmented('lines', (v) => hero.update({ lines: Number(v) }));
segmented('gap', (v) => hero.update({ gap: v as Gap }));
segmented('justify', (v) => hero.update({ justify: v === 'off' ? false : (v as 'ellipsis' | 'dots' | 'spread') }));

const ellipsisStyles: Record<string, EllipsisStyle> = {
  glyph: '\u2026',
  periods: '...',
  dot: { shape: 'dot' },
  bullet: { shape: 'bullet' },
  ring: { shape: 'ring' },
  square: { shape: 'square' },
};
segmented('ellipsis', (v) => hero.update({ ellipsis: ellipsisStyles[v] }));

const showGuides = $<HTMLInputElement>('#showGuides');
showGuides.addEventListener('change', () => {
  if (!showGuides.checked) heroGuides.replaceChildren();
});

// Live readout of the instance state.
const readout = $('#readout');
let lastReadout = '';
function renderReadout() {
  const s = hero.state;
  const px = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(2)}`);
  const g = s.gaps[0];
  const rows: [string, string][] = [
    ['truncated', String(s.truncated)],
    ['hidden', s.hidden.length ? s.hidden.map((h) => `[${h.start}, ${h.end})`).join(' ') : '–'],
    ['omitted', s.hidden.length ? JSON.stringify(s.hidden.map((h) => h.text).join(' | ')) : '–'],
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
renderReadout();

// Breathing: sweep the width back and forth.
const breathe = $<HTMLInputElement>('#breathe');
if (matchMedia('(prefers-reduced-motion: reduce)').matches) breathe.checked = false;
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
  for (const [instance, layer] of compareGuides) drawGuides(instance, layer);
  renderReadout();
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
    layer.setAttribute('aria-hidden', 'true');
    cell.append(p, layer);
    compare.append(cell);
    compareGuides.push([elide(p, { position: sample.position, gap, justify: false }), layer]);
  }
}

// ---------------------------------------------------------------------------
// Keep parts, many ellipses

const keepExamples: Elide[] = [
  elide($('#exFile'), { keep: /\.[^.]+$/, glyphs: true }),
  elide($('#exFox'), { keep: 'fox', position: 'middle', glyphs: true }),
  elide($('#exHash'), { position: [0.25, 0.75], glyphs: true }),
  elide($('#exLog'), { keep: [/^\S+ \S+/, /ERR_\w+/], position: 'middle', glyphs: true }),
];
for (const instance of keepExamples) transitions(instance, { effect: 'merge' });
resizable($('#keepBox'));
Object.assign(window, { keepExamples });

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
  li.tabIndex = 0;
  li.innerHTML = fileIcon;
  const span = document.createElement('span');
  span.className = 'path';
  span.textContent = path;
  li.append(span);
  list.append(li);
  const instance = elide(span, { position: 0.5, snap: snapPaths });
  // No glyph effects in text mode, but the dots still glide to their new spacing.
  transitions(instance);
  pathInstances.push(instance);
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
  // The line rect is the font's content area; centre it in the tip's line box.
  const x = first.left - parseFloat(cs.paddingLeft);
  const y = first.top - (lineHeight - first.height) / 2 - parseFloat(cs.paddingTop);
  expandTip.style.left = `${Math.round(x)}px`;
  expandTip.style.top = `${Math.round(y)}px`;
}

/** Only what one ellipsis hides, anchored to that ellipsis' ink. */
function showPeek(instance: Elide, index: number) {
  const ink = instance.ellipsisInk(index);
  const part = instance.state.hidden[index];
  if (!ink || !part) return hideTips();
  peekTip.textContent = part.text;
  peekTip.hidden = false;
  peekTip.style.left = `${ink.left + ink.width / 2}px`;
  peekTip.style.top = `${ink.top - 12}px`;
}

const rowInstance = (row: Element | null) => pathInstances[row ? Array.prototype.indexOf.call(list.children, row) : -1];
list.addEventListener('pointerover', (e) => {
  const target = e.target as HTMLElement;
  const instance = rowInstance(target.closest('li'));
  if (!instance) return hideTips();
  if (reveal === 'expand') return showExpand(instance);
  const index = instance.ellipsisIndex(target);
  if (index >= 0) showPeek(instance, index);
  else hideTips();
});
list.addEventListener('pointerleave', hideTips);
// Keyboard: focusing a row shows its full text, or the first hidden part.
list.addEventListener('focusin', (e) => {
  const instance = rowInstance((e.target as HTMLElement).closest('li'));
  if (!instance) return;
  if (reveal === 'expand') showExpand(instance);
  else if (instance.truncated) showPeek(instance, 0);
});
list.addEventListener('focusout', hideTips);
window.addEventListener('scroll', hideTips, { passive: true });

// ---------------------------------------------------------------------------
// Multi-line

const article = elide($('#article'), { lines: 3, position: 0.7 });
transitions(article);
const mpos = $<HTMLInputElement>('#mpos');
mpos.addEventListener('input', () => {
  $('#mposOut').textContent = `${mpos.value}%`;
  article.update({ position: Number(mpos.value) / 100 });
});
segmented('mlines', (v) => article.update({ lines: Number(v) }));
resizable($('#cardBox'));

requestAnimationFrame(tick);
