import { type Elide, type EllipsisStyle, type Gap, elide, separators, words } from '#src/index.ts';
import { type Reveal, tooltip } from '#src/tooltip.ts';
import { type Effect, transitions } from '#src/transitions.ts';
import { $, resizable, segmented } from './ui.ts';

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
const byWords = words();
segmented('words', (v) => hero.update({ snap: v === 'words' ? byWords : null }));

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
    } else {
      keep.push(part);
    }
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
  animate();
});

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

// Breathing: sweep the width back and forth. Frames only run while it
// breathes or the guides are on (they follow the dots as they glide).
const breathe = $<HTMLInputElement>('#breathe');
if (matchMedia('(prefers-reduced-motion: reduce)').matches) breathe.checked = false;
breathe.addEventListener('change', animate);
let phase = 0.62;
let last = 0;
let frame = 0;
function tick(now: number) {
  frame = 0;
  const dt = last !== 0 ? Math.min(64, now - last) : 16;
  last = now;
  if (breathe.checked) {
    phase += dt / 7000;
    const max = heroBox.parentElement!.clientWidth - 64;
    const min = Math.min(260, max);
    const t = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    heroBox.style.width = `${min + (max - min) * t}px`;
  }
  if (showGuides.checked) drawGuides(hero, heroGuides);
  if (breathe.checked || showGuides.checked) frame = requestAnimationFrame(tick);
  else last = 0;
}
function animate() {
  frame ||= requestAnimationFrame(tick);
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
    // Redrawn only when the text is laid out again: nothing moves in between.
    const instance = elide(p, { position: sample.position, gap, justify: false });
    instance.onRender(() => drawGuides(instance, layer));
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

// One tooltip per list: after the first tip's delay, the rest of the list's show at once.
const filesBox = $('#filesBox');
const fileTips = tooltip({
  reveal: 'expand',
  breaks: '/\\',
  offset: 12,
  // The ellipsis' highlight covers its gaps too.
  onShow: ({ instance, ellipsis }) => {
    const el = ellipsis === null ? null : instance.ellipses[ellipsis];
    if (!el) return;
    const cs = getComputedStyle(el);
    el.style.setProperty('--peek-left', cs.marginLeft);
    el.style.setProperty('--peek-right', cs.marginRight);
  },
});
for (const [i, instance] of pathInstances.entries()) fileTips.attach(instance, list.children[i]);
segmented('reveal', (v) => {
  fileTips.update({ reveal: v as Reveal });
  filesBox.classList.toggle('reveal-peek', v === 'peek');
});
resizable(filesBox);

// ---------------------------------------------------------------------------
// A tooltip grown from the line, over long paths.

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
const growInstances: Elide[] = [];
const growTips = tooltip({ breaks: '/\\' });
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
  growTips.attach(instance, li);
}
resizable($('#growBox'));
segmented('delay', (v) => {
  for (const tips of [fileTips, growTips]) tips.update({ delay: Number(v) });
});
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

// ---------------------------------------------------------------------------
// Links, suffixes and find in page

// The button is the post's own: it moves to the end of the last line, and
// shows while there's more to read (or the post is expanded).
const postEl = $('#post');
const more = $<HTMLButtonElement>('.more', postEl);
const post = elide(postEl, { lines: 3, suffix: more, showSuffix: 'truncated', find: 'expand' });
more.addEventListener('click', () => (post.expanded ? post.collapse() : post.expand()));
// Find in page expands it too.
post.onRender((state) => (more.textContent = state.expanded ? 'Show less' : 'Read more'));
const issues = [...document.querySelectorAll<HTMLElement>('#issues p')].map((p) => elide(p, { suffix: $('.badge', p) }));
const commit = elide($('#commit'), { position: 0.6 });
resizable($('#richBox'));
Object.assign(window, { post, issues, commit });

animate();
