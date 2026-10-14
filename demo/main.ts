import { type Elide, type EllipsisStyle, type Gap, elide, separators } from '../src/index.js';
import { growTip } from './grow-tip.js';
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

// Ellipsis style and number of dots. The font's own '…' is three dots; any
// other count draws dots shaped like its own.
let markKind = 'glyph';
const count = $<HTMLInputElement>('#count');
function ellipsisStyle(): EllipsisStyle {
  const n = Number(count.value);
  if (markKind === 'glyph') return n === 3 ? '…' : { shape: 'dot', like: '…', count: n };
  if (markKind === 'periods') return '.'.repeat(n);
  return { shape: markKind as 'dot' | 'bullet' | 'ring' | 'square', count: n };
}
segmented('ellipsis', (v) => {
  markKind = v;
  hero.update({ ellipsis: ellipsisStyle() });
});
count.addEventListener('input', () => {
  $('#countOut').textContent = count.value;
  hero.update({ ellipsis: ellipsisStyle() });
});

// Keep visible: comma-separated words, or /regex/flags.
const keepInput = $<HTMLInputElement>('#keep');
function applyKeep() {
  const keep: (string | RegExp)[] = [];
  let valid = true;
  for (const raw of keepInput.value.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const re = /^\/(.+)\/([dgimsuvy]*)$/.exec(part);
    if (re) {
      try {
        keep.push(new RegExp(re[1]!, re[2]));
      } catch {
        valid = false;
      }
    } else keep.push(part);
  }
  keepInput.toggleAttribute('aria-invalid', !valid);
  hero.update({ keep });
}
keepInput.addEventListener('input', applyKeep);
$('.hints').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  keepInput.value = btn.value;
  applyKeep();
});

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
const snaps = {
  off: null,
  whole: separators('/\\', { fragment: false }),
  head: separators('/\\'),
  tail: separators('/\\', { fragment: 'tail' }),
};
for (const path of paths) {
  const li = document.createElement('li');
  li.tabIndex = 0;
  li.innerHTML = fileIcon;
  const span = document.createElement('span');
  span.className = 'path';
  span.textContent = path;
  li.append(span);
  list.append(li);
  const instance = elide(span, { position: 0.5, snap: snaps.head });
  // No glyph effects in text mode, but the dots still glide to their new spacing.
  transitions(instance);
  pathInstances.push(instance);
}
Object.assign(window, { pathInstances });
segmented('snap', (v) => {
  for (const p of pathInstances) p.update({ snap: snaps[v as keyof typeof snaps] });
});

let reveal: 'expand' | 'grow' | 'peek' = 'expand';
const filesBox = $('#filesBox');
segmented('reveal', (v) => {
  reveal = v as typeof reveal;
  filesBox.classList.toggle('reveal-peek', reveal === 'peek');
  hideTips();
});
resizable(filesBox, hideTips);

const expandTip = $('#expandTip');
const peekTip = $('#peekTip');
// What the tips show now, so moving within a row (or an ellipsis) doesn't restart them.
let tipRow: Element | null = null;
let peeking: { instance: Elide; index: number; row: Element } | null = null;
function hideTips() {
  expandTip.hidden = true;
  peekTip.hidden = true;
  tipRow = null;
  setPeeking(null);
}

const EDGE = 8;
const SEPARATORS = '/\\';
const easeOut = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** The tip's background, a layer of its own so it can change size without reflowing the text. */
function tipBackground() {
  const bg = document.createElement('div');
  bg.className = 'tip-bg';
  return bg;
}

/** Items with a line break opportunity after each path separator. */
function breakAfterSeparators<T extends Node | string>(items: T[], text: readonly string[]): (T | HTMLElement)[] {
  return items.flatMap((item, i) => (SEPARATORS.includes(text[i]!) ? [item, document.createElement('wbr')] : [item]));
}

/**
 * Place the full-text tip. Its first line goes exactly over the instance's
 * first line when the whole text fits there on one line; otherwise the tip
 * slides left just enough to stay on screen; and when even the screen is too
 * narrow, it wraps at the screen's width (between path segments where it can).
 */
function placeTip(instance: Elide): boolean {
  const first = instance.lineRects()[0];
  if (!first) return false;
  const tip = expandTip;
  tip.hidden = false;
  const cs = getComputedStyle(tip);
  const lineHeight = parseFloat(cs.lineHeight);
  const view = document.documentElement.clientWidth;
  const room = view - EDGE * 2;
  // Its width on one line.
  tip.style.maxWidth = '';
  tip.style.left = '0px';
  tip.style.whiteSpace = 'nowrap';
  const natural = tip.getBoundingClientRect().width;
  tip.style.whiteSpace = '';
  let x = first.left - parseFloat(cs.paddingLeft);
  if (natural <= room) x = Math.min(Math.max(x, EDGE), view - EDGE - natural);
  else {
    x = EDGE;
    tip.style.maxWidth = `${room}px`;
  }
  tip.style.left = `${Math.round(x)}px`;
  // The line rect is the font's content area; centre it in the tip's line box.
  let y = first.top - (lineHeight - first.height) / 2 - parseFloat(cs.paddingTop);
  const height = tip.getBoundingClientRect().height;
  if (y + height > innerHeight - EDGE) y = Math.max(EDGE, innerHeight - EDGE - height);
  tip.style.top = `${Math.round(y)}px`;
  return true;
}

/** Full text, laid exactly over the truncated text so the letters line up (when it fits). */
function showExpand(instance: Elide) {
  if (!instance.truncated) return hideTips();
  const g = instance.graphemes;
  const pieces: string[] = [];
  let at = 0;
  g.forEach((ch, i) => {
    if (SEPARATORS.includes(ch) || i === g.length - 1) {
      pieces.push(g.slice(at, i + 1).join(''));
      at = i + 1;
    }
  });
  expandTip.replaceChildren(tipBackground(), ...pieces.flatMap((p, i) => (i ? [document.createElement('wbr'), p] : [p])));
  if (!placeTip(instance)) hideTips();
}

/**
 * Full text grown out of the truncated text. The tip is laid out as it will
 * end up (on one line or wrapped, wherever it fits), and then every glyph
 * comes from where it is now: the ones showing from their place in the line,
 * the hidden ones out of the ellipsis that hides them, while the dots fade
 * and the background grows from the line's box to the tip's.
 */
function showGrow(instance: Elide) {
  if (!instance.truncated) return hideTips();
  const g = instance.graphemes;
  const { hidden } = instance.state;

  // Where everything is now, before the tip covers it.
  const from: ({ x: number; y: number } | { cx: number; cy: number })[] = [];
  g.forEach((_, i) => {
    const r = instance.graphemeRect(i);
    if (r) from[i] = { x: r.left, y: r.top };
  });
  hidden.forEach((part, j) => {
    const area = instance.ellipsisArea(j);
    if (!area) return;
    const count = part.end - part.start;
    for (let k = 0; k < count; k++) {
      from[part.start + k] = { cx: area.left + ((k + 0.5) / count) * area.width, cy: area.top + area.height / 2 };
    }
  });
  const marks = hidden.flatMap((_, j) => instance.markElements(j).map((el) => ({ el, rect: el.getBoundingClientRect() })));
  const lines = instance.lineRects();

  // The tip as it will end up.
  const bg = tipBackground();
  const glyphs = g.map((ch) => {
    const span = document.createElement('span');
    span.textContent = ch;
    return span;
  });
  expandTip.replaceChildren(bg, ...breakAfterSeparators(glyphs, g));
  if (!placeTip(instance)) return hideTips();
  const tip = expandTip.getBoundingClientRect();

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timing = { duration: still ? 0 : 460, easing: easeOut, fill: 'backwards' } as const;

  // Inline text can't be transformed (and inline-blocks would break lines
  // anywhere), so glyphs travel by relative offsets, which move them without
  // reflowing anything.
  glyphs.forEach((span, i) => {
    const start = from[i];
    if (!start) return;
    const to = span.getBoundingClientRect();
    if ('x' in start) {
      const dx = start.x - to.left;
      const dy = start.y - to.top;
      if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;
      span.animate([{ left: `${dx}px`, top: `${dy}px` }, { left: '0px', top: '0px' }], timing);
    } else {
      const dx = start.cx - (to.left + to.width / 2);
      const dy = start.cy - (to.top + to.height / 2);
      span.animate(
        [
          { left: `${dx}px`, top: `${dy}px`, opacity: 0, filter: 'blur(3px)' },
          { offset: 0.15, opacity: 0 },
          { offset: 0.6, opacity: 1, filter: 'blur(0px)' },
          { left: '0px', top: '0px', opacity: 1, filter: 'blur(0px)' },
        ],
        timing,
      );
    }
  });

  // The ellipses' dots, as drawn, where they are, fading as the text arrives.
  for (const { el, rect } of marks) {
    const dot = el.cloneNode(true) as HTMLElement;
    dot.classList.add('tip-dot');
    dot.style.margin = '0';
    dot.style.transform = 'none';
    dot.style.left = `${rect.left - tip.left}px`;
    dot.style.top = `${rect.top - tip.top}px`;
    expandTip.append(dot);
    dot.animate([{ opacity: 1 }, { offset: 0.35, opacity: 0 }, { opacity: 0 }], { ...timing, easing: 'linear', fill: 'both' });
  }

  // The background, from the line's box (with the tip's padding) to the tip's.
  const cs = getComputedStyle(expandTip);
  const lineHeight = parseFloat(cs.lineHeight);
  const firstLine = lines[0]!;
  const lastLine = lines[lines.length - 1]!;
  const box = {
    left: Math.min(...lines.map((l) => l.left)) - parseFloat(cs.paddingLeft),
    right: Math.max(...lines.map((l) => l.right)) + parseFloat(cs.paddingRight),
    top: firstLine.top - (lineHeight - firstLine.height) / 2 - parseFloat(cs.paddingTop),
    bottom: lastLine.top - (lineHeight - lastLine.height) / 2 + lineHeight + parseFloat(cs.paddingBottom),
  };
  const inset = `${box.top - tip.top}px ${tip.right - box.right}px ${tip.bottom - box.bottom}px ${box.left - tip.left}px`;
  bg.animate([{ inset }, { inset: '0px' }], timing);
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

/** Mark the ellipsis being peeked at, so its whole area can be highlighted. */
function setPeeking(next: typeof peeking) {
  if (peeking) {
    peeking.instance.ellipses[peeking.index]?.removeAttribute('data-peek');
    peeking.row.classList.remove('peeking');
  }
  peeking = next;
  if (!next) return;
  const el = next.instance.ellipses[next.index];
  if (el) {
    const cs = getComputedStyle(el);
    el.style.setProperty('--peek-left', cs.marginLeft);
    el.style.setProperty('--peek-right', cs.marginRight);
    el.setAttribute('data-peek', '');
  }
  next.row.classList.add('peeking');
}

const rowInstance = (row: Element | null) => pathInstances[row ? Array.prototype.indexOf.call(list.children, row) : -1];
function showRow(row: Element) {
  const instance = rowInstance(row);
  if (!instance || row === tipRow) return;
  hideTips();
  tipRow = row;
  if (reveal === 'grow') showGrow(instance);
  else showExpand(instance);
}
list.addEventListener('pointermove', (e) => {
  const row = (e.target as HTMLElement).closest('li');
  const instance = rowInstance(row);
  if (!row || !instance) return hideTips();
  if (reveal !== 'peek') return showRow(row);
  // The ellipsis element only spans its marks; its area covers the gaps too.
  const index = instance.ellipsisAt(e.clientX, e.clientY, 4);
  if (index === peeking?.index && instance === peeking.instance) return;
  hideTips();
  if (index < 0) return;
  setPeeking({ instance, index, row });
  showPeek(instance, index);
});
list.addEventListener('pointerleave', hideTips);
// Keyboard: focusing a row shows its full text, or the first hidden part.
list.addEventListener('focusin', (e) => {
  const row = (e.target as HTMLElement).closest('li');
  const instance = rowInstance(row);
  if (!row || !instance) return;
  if (reveal !== 'peek') showRow(row);
  else if (instance.truncated) showPeek(instance, 0);
});
list.addEventListener('focusout', hideTips);
// Only a real scroll moves the rows from under their tips.
let scrolled = [scrollX, scrollY];
window.addEventListener(
  'scroll',
  () => {
    if (scrollX === scrolled[0] && scrollY === scrolled[1]) return;
    scrolled = [scrollX, scrollY];
    hideTips();
  },
  { passive: true },
);

// ---------------------------------------------------------------------------
// The README's tooltip, grown from the line, over long paths.

const longPaths = [
  '/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/Projects/analytical-engine/archive/2026/notes/drafts/second-pass/reviewed/with-comments-from-charles/final-final/do-not-touch/really-final/sketches-of-the-analytical-engine-invented-by-charles-babbage-with-notes-by-the-translator-and-a-few-more-by-the-editor-who-could-not-resist-adding-their-own.md',
  'C:\\Users\\grace\\AppData\\Local\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings\\backups\\2026-10-14\\profiles\\defaults\\color-schemes\\campbell-powershell.json',
  'node_modules/.pnpm/@babel+plugin-transform-modules-commonjs@7.27.1_@babel+core@7.28.0/node_modules/@babel/plugin-transform-modules-commonjs/lib/index.js',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/typescript-language-features/package.nls.json',
  '/var/log/nginx/access.log.2026-10-14.gz',
  'https://example.com/docs/guides/typography/truncation/balanced-ellipsis/measuring-ink/raster-scans/why-canvas-metrics-lie-about-dots?ref=floating-ellipsis&utm_source=readme#the-128px-reference',
  '/srv/media/photos/2026/iceland/day-04/glacier-lagoon/IMG_4821.HEIC',
];
const growList = $('#growFiles');
const growTipEl = $('#growTip');
const growInstances: Elide[] = [];
for (const path of longPaths) {
  const li = document.createElement('li');
  li.tabIndex = 0;
  li.innerHTML = fileIcon;
  const span = document.createElement('span');
  span.className = 'path';
  span.textContent = path;
  li.append(span);
  growList.append(li);
  // The Windows path has two ellipses: each hidden part comes out of its own.
  const position = path.startsWith('C:') ? [0.3, 0.7] : 0.5;
  const instance = elide(span, { position, snap: snaps.head });
  transitions(instance);
  growInstances.push(instance);
  const show = () => growTip(instance, growTipEl);
  li.addEventListener('pointerenter', show);
  li.addEventListener('focus', show);
}
const hideGrowTip = () => (growTipEl.hidden = true);
growList.addEventListener('pointerleave', hideGrowTip);
growList.addEventListener('focusout', hideGrowTip);
resizable($('#growBox'), hideGrowTip);
let growScrolled = [scrollX, scrollY];
window.addEventListener(
  'scroll',
  () => {
    if (scrollX === growScrolled[0] && scrollY === growScrolled[1]) return;
    growScrolled = [scrollX, scrollY];
    hideGrowTip();
  },
  { passive: true },
);
Object.assign(window, { growInstances });

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
