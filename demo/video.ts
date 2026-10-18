import { glyphs } from '#src/glyphs.ts';
import { type Elide, type ElideOptions, elide } from '#src/index.ts';
import { suffix } from '#src/suffix.ts';
import { type TooltipOptions, tooltip } from '#src/tooltip.ts';
import { type TransitionOptions, transitions } from '#src/transitions.ts';
import {
  calm,
  code,
  fast,
  fileIcon,
  hero,
  issues,
  keepRows,
  lantern,
  lanternPosition,
  lensAt,
  lineSteps,
  post as postText,
  quote,
  river,
  sharedColumns,
  siblings,
  snapRows,
  tooltipOptions,
  toggleSmoothly,
  tooltipPaths,
} from './examples.ts';
import { $ } from './ui.ts';

/**
 * A short video of the library, played as a script of scenes in a 1280×720
 * frame. It plays in real time when opened; `scripts/video.ts` records it
 * frame by frame (`?record`) with the page's clock under its control.
 * `?scene=N` starts at scene N.
 */

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// Time

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const out = (k: number) => 1 - (1 - k) ** 3;

/** Tweens running, each stepped once a frame: by animation frames, or by the recorder. */
const tweens = new Set<(now: number) => void>();
const recording = params.has('record');

function stepTweens() {
  const now = performance.now();
  for (const step of tweens) step(now);
  if (!recording && tweens.size > 0) requestAnimationFrame(stepTweens);
}

/** Call `step` every frame for `ms`, with the eased progress. */
function tween(ms: number, step: (k: number) => void, curve = smooth): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / ms));
      step(curve(k));
      if (k < 1) return;
      tweens.delete(frame);
      resolve();
    };
    if (!recording && tweens.size === 0) requestAnimationFrame(stepTweens);
    tweens.add(frame);
  });
}

/** Tween an element's width in px. */
function widen(el: HTMLElement, to: number, ms: number, curve = smooth) {
  const from = el.getBoundingClientRect().width;
  return tween(ms, (k) => (el.style.width = `${lerp(from, to, k)}px`), curve);
}

// ---------------------------------------------------------------------------
// The pointer: drawn, and dispatching pointer events where it is, so tooltips see it.

const cursor = $('#cursor');
const pointer = { x: 1180, y: 800 };

function hover() {
  cursor.style.transform = `translate(${pointer.x - 5}px, ${pointer.y - 3.5}px)`;
  const target = document.elementFromPoint(pointer.x, pointer.y) ?? document.body;
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: pointer.x, clientY: pointer.y, pointerType: 'mouse' }));
  // (:hover can't be faked.)
  for (const li of document.querySelectorAll('.files li')) li.classList.toggle('hover', li.contains(target));
}

function moveTo([x, y]: [number, number], ms: number) {
  const [x0, y0] = [pointer.x, pointer.y];
  return tween(ms, (k) => {
    pointer.x = lerp(x0, x, k);
    pointer.y = lerp(y0, y, k);
    hover();
  });
}

/** A point in an element's box, `fx` and `fy` of the way across. */
function at(el: Element, fx = 0.5, fy = 0.5): [number, number] {
  const r = el.getBoundingClientRect();
  return [r.left + r.width * fx, r.top + r.height * fy];
}

function showCursor(on: boolean) {
  return cursor.animate({ opacity: on ? [0, 1] : [1, 0] }, { duration: 200, fill: 'forwards' }).finished;
}

async function click(el: HTMLElement) {
  cursor.animate({ scale: [1, 0.86, 1] }, { duration: 220, easing: 'ease-out' });
  await wait(110);
  el.click();
  await wait(110);
}

// ---------------------------------------------------------------------------
// Scenes

const scenes = $('#scenes');
const counter = $('#counter');
const chapters = 9;

class Scene {
  readonly section = document.createElement('section');
  readonly stage = document.createElement('div');
  readonly #code = document.createElement('p');
  readonly #cleanups: (() => void)[] = [];

  constructor(chapter: number | null, title: string, src = '') {
    this.section.className = 'scene';
    counter.innerHTML = chapter === null ? '' : `<b>${String(chapter).padStart(2, '0')}</b> / ${chapters}`;
    if (chapter === null) {
      this.section.classList.add('title-card');
      this.section.innerHTML = title;
    } else {
      const h2 = document.createElement('h2');
      h2.innerHTML = title;
      this.#code.className = 'code';
      this.code(src);
      this.stage.className = 'stage';
      this.section.append(h2, this.#code, this.stage);
    }
    this.section.style.opacity = '0';
    scenes.append(this.section);
  }

  code(src: string) {
    this.#code.innerHTML = code(src);
  }

  elide(el: HTMLElement, options: ElideOptions, motion: TransitionOptions | null = null): Elide {
    const t = elide(el, options);
    if (motion) this.#cleanups.push(transitions(t, motion));
    this.#cleanups.push(() => t.destroy());
    return t;
  }

  tooltip(options: TooltipOptions) {
    const tips = tooltip(options);
    this.#cleanups.push(() => tips.destroy());
    return tips;
  }

  /** Fade in, part by part; the scene's action starts while it settles. */
  async enter() {
    this.section.style.opacity = '';
    [...this.section.children].forEach((el, i) =>
      el.animate(
        [
          { opacity: 0, translate: '0 18px' },
          { opacity: 1, translate: '0 0' },
        ],
        {
          duration: 520,
          delay: i * 70,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
          fill: 'backwards',
        },
      ),
    );
    await wait(420);
  }

  async leave() {
    await this.section.animate([{ opacity: 1 }, { opacity: 0, translate: '0 -10px' }], {
      duration: 260,
      easing: 'ease-in',
      fill: 'forwards',
    }).finished;
    for (const fn of this.#cleanups.splice(0)) fn();
    this.section.remove();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  node.innerHTML = html;
  return node;
}

/** A box `width` px wide holding `children`; its right edge is drawn. */
function box(width: number, ...children: Node[]) {
  const b = el('div', 'box');
  b.style.width = `${width}px`;
  b.append(...children);
  return b;
}

async function intro() {
  const s = new Scene(null, '<h1>Truncate text <em>anywhere.</em></h1>');
  const line = el('p', 'line', hero);
  const b = box(1080, line);
  b.classList.add('quiet');
  s.section.append(b);
  s.elide(line, { position: 0.5, glyphs }, fast);
  await s.enter();
  await wait(250);
  await widen(b, 560, 1500);
  await wait(450);
  await s.leave();
}

async function position() {
  const s = new Scene(1, 'Put the ellipsis <em>anywhere.</em>', 'elide(el, { position: «1.00» })');
  const line = el('p', 'line', hero);
  const knob = el('div', 'knob');
  const track = el('div', 'track');
  track.append(knob);
  s.stage.append(box(1000, line), track);
  track.style.width = '1000px';
  const t = s.elide(line, { position: 1, glyphs }, fast);
  const go = (v: number) => {
    t.update({ position: v });
    knob.style.left = `${v * 100}%`;
    s.code(`elide(el, { position: «${v.toFixed(2)}» })`);
  };
  go(1);
  await s.enter();
  for (const [from, to, ms] of [
    [1, 0.5, 950],
    [0.5, 0, 900],
    [0, 0.3, 700],
  ] as const) {
    await tween(ms, (k) => go(lerp(from, to, k)));
    await wait(260);
  }
  await wait(300);
  await s.leave();
}

/** Several lines, then several ellipses, then marks of other shapes: one change at a time. */
async function lines() {
  const [first, ...steps] = lineSteps;
  const s = new Scene(2, 'Any number of lines and <em>ellipses.</em>', `elide(el, { ${first!.src} })`);
  const para = el('p', 'para', river);
  const card = el('article', 'card box', '<h3>Field notes</h3>');
  card.append(para);
  card.style.width = '980px';
  s.stage.append(card);
  const t = s.elide(para, first!.options, calm);
  await s.enter();
  await wait(300);
  await widen(card, 720, 1100);
  for (const { options, src } of steps) {
    await wait(1000);
    t.update(options);
    s.code(`elide(el, { ${src} })`);
  }
  await wait(1100);
  await s.leave();
}

async function suffixes() {
  const s = new Scene(3, 'Suffixes are <em>never cut.</em>', "elide(el, { lines: «2», suffix: suffix(button, { show: «'truncated'» }) })");
  const post = el('p', 'para', postText);
  const more = el('button', 'more', 'Read more');
  post.append(more);
  const list = el('div', 'issues');
  const issueLines = issues.map((html) => el('p', 'line', html));
  list.append(...issueLines);
  const b = box(1040, post, list);
  s.stage.append(b);
  const t = s.elide(post, { lines: 2, suffix: suffix(more, { show: 'truncated' }) });
  t.onRender((state) => (more.textContent = state.expanded ? 'Show less' : 'Read more'));
  more.addEventListener('click', () => toggleSmoothly(t));
  for (const line of issueLines) {
    const badge = line.querySelector<HTMLElement>('.badge')!;
    s.elide(line, { suffix: suffix(badge) });
  }
  await s.enter();
  // It all fits: no button.
  await wait(700);
  await widen(b, 600, 1300);
  await wait(250);
  await showCursor(true);
  await moveTo(at(more), 600);
  await click(more);
  await wait(1200);
  await moveTo(at(more), 300);
  await click(more);
  await wait(800);
  await moveTo([pointer.x + 120, pointer.y + 160], 350);
  await showCursor(false);
  await s.leave();
}

async function snapping() {
  const s = new Scene(4, 'Cut between words or path <em>segments.</em>', "snap: words()      snap: separators(«'/'»)");
  const list = el('div', 'rows');
  const rows = snapRows.map(({ label, text, mono, options }) => {
    const row = el('div', 'row', `<code>${label}</code>`);
    const line = el('p', mono ? 'line mono' : 'line', text);
    row.append(line);
    list.append(row);
    return { line, options };
  });
  list.style.width = '1000px';
  s.stage.append(list);
  for (const { line, options } of rows) s.elide(line, options);
  await s.enter();
  await wait(200);
  await widen(list, 600, 1700);
  await wait(250);
  await widen(list, 860, 1000);
  await wait(400);
  await s.leave();
}

/** A file list; `fits` adds a tag that follows `truncated`. */
function files(s: Scene, paths: string[], options: ElideOptions, fits = false) {
  const list = el('ul', 'files');
  const made = paths.map((path) => {
    const li = el('li', '', fileIcon(22));
    const span = el('span', 'path', path);
    li.append(span);
    list.append(li);
    return { li, span };
  });
  s.stage.append(list);
  return made.map(({ li, span }) => {
    const t = s.elide(span, options, calm);
    if (fits) {
      const tag = el('span', 'fits');
      li.append(tag);
      const show = () => {
        tag.textContent = t.truncated ? 'truncated' : 'fits';
        tag.classList.toggle('cut', t.truncated);
      };
      t.onRender(show);
      show();
    }
    return { li, t };
  });
}

/** Rows that fit show no tooltip; cut ones grow theirs out of the line. */
async function tooltips() {
  const s = new Scene(5, 'Tooltips only where text is <em>cut.</em>', "tooltip({ reveal: «'grow'» }).attach(instance)");
  const rows = files(s, tooltipPaths, tooltipOptions, true);
  s.stage.querySelector<HTMLElement>('.files')!.style.width = '860px';
  // Wide enough for the second row's tip to stay on one line; the last one wraps.
  const tips = s.tooltip({ reveal: 'grow', delay: 250, grace: 0, breaks: '/\\', duration: 700, maxWidth: 0.75 });
  for (const { li, t } of rows) tips.attach(t, li);
  await s.enter();
  pointer.x = 1000;
  pointer.y = 640;
  await showCursor(true);
  for (const [i, rest] of [
    [0, 550],
    [1, 1400],
    [2, 550],
    [3, 1600],
  ] as const) {
    await moveTo(at(rows[i]!.li, 0.42, 0.55), 380);
    await wait(rest);
  }
  await moveTo([pointer.x + 200, 700], 400);
  await showCursor(false);
  await s.leave();
}

async function keeping() {
  const s = new Scene(6, 'Pin the parts that <em>matter.</em>', "keep: [/\\.pdf$/, { match: /fox|porch/, class: «'hit'» }]");
  const list = el('div', 'rows');
  const b = box(1000, list);
  s.stage.append(b);
  for (const { text, mono, options } of keepRows) {
    const line = el('p', mono ? 'line mono' : 'line', text);
    list.append(line);
    s.elide(line, options);
  }
  await s.enter();
  await wait(200);
  await widen(b, 480, 1800);
  await wait(300);
  await widen(b, 800, 900);
  await wait(400);
  await s.leave();
}

async function find() {
  const s = new Scene(7, 'Find in page <em>finds it.</em>', "elide(el, { find: «'keep'» }) // the default");
  const bar = el('div', 'findbar', '<span class="query"></span><span class="count"></span><kbd>Enter</kbd>');
  const query = bar.querySelector<HTMLElement>('.query')!;
  const count = bar.querySelector<HTMLElement>('.count')!;
  const lines = lantern.map((text) => el('p', 'line', text));
  const list = el('div', 'rows find-rows');
  list.append(...lines);
  const b = box(1000, list);
  s.stage.append(bar, b);
  for (const [i, line] of lines.entries()) s.elide(line, { position: lanternPosition(lantern[i]!) }, calm);
  await s.enter();
  await wait(300);
  for (const ch of 'lantern') {
    query.textContent += ch;
    await wait(65);
  }
  for (const [i, line] of lines.entries()) {
    count.textContent = `${i + 1}/${lines.length}`;
    // What find in page fires on the hidden word it found.
    const found = lantern[i]!.indexOf('lantern');
    const word = line.querySelector(`[data-fp-word="${found}:${found + 7}"]`);
    word?.dispatchEvent(new Event('beforematch', { bubbles: true }));
    await wait(1100);
  }
  await wait(200);
  await s.leave();
}

/** Siblings cut in the middle all look alike; keeping what differs tells them apart. */
async function shared() {
  const s = new Scene(8, 'Customize: cut what’s <em>shared.</em>', "keep: differing(path, siblings), snap: separators(«'/'»)");
  const split = el('div', 'split box');
  for (const [label, options] of sharedColumns) {
    const column = el('div', 'rows', `<code>${label}</code>`);
    split.append(column);
    for (const path of siblings) {
      const line = el('p', 'line mono', path);
      column.append(line);
      s.elide(line, options(path), calm);
    }
  }
  split.style.width = '1060px';
  s.stage.append(split);
  await s.enter();
  await wait(500);
  await widen(split, 780, 1600);
  await wait(1800);
  await s.leave();
}

/** `keep` and `position` following the pointer. */
async function lens() {
  const s = new Scene(9, 'Customize: a <em>lens.</em>', 'keep: { start: «0», end: «0» }, position: «0.00»');
  s.section.classList.add('lens');
  const line = el('p', 'line', quote);
  const b = box(1000, line);
  b.classList.add('quiet');
  s.stage.append(b, el('p', 'lens-hint', '— Ada Lovelace, 1843'));
  const n = [...new Intl.Segmenter().segment(quote)].length;
  const t = s.elide(line, { position: 0.5, glyphs }, fast);
  const look = () => {
    const r = b.getBoundingClientRect();
    const { options, src } = lensAt(Math.min(1, Math.max(0, (pointer.x - r.left) / r.width)), n);
    t.update(options);
    s.code(src);
  };
  await s.enter();
  pointer.x = 140;
  pointer.y = at(line)[1] + 50;
  await showCursor(true);
  look();
  const [x0, y] = [pointer.x, pointer.y];
  const left = b.getBoundingClientRect().left;
  await tween(2600, (k) => {
    pointer.x = lerp(x0, left + 1000, k);
    pointer.y = y;
    hover();
    look();
  });
  await wait(200);
  await tween(1200, (k) => {
    pointer.x = lerp(left + 1000, left + 420, k);
    hover();
    look();
  });
  await wait(500);
  await showCursor(false);
  await s.leave();
}

async function outro() {
  const s = new Scene(
    null,
    '<p class="install"><span>$</span> npm i floating-ellipsis</p><p class="tags">React · Vue · Svelte · Web Components · Vanilla</p><p class="url">gkurt.com/floating-ellipsis</p>',
  );
  const name = el('h1', '', 'floating-ellipsis');
  const b = box(0, name);
  b.classList.add('quiet');
  b.style.width = '';
  s.section.prepend(b);
  const full = name.scrollWidth + 4;
  b.style.width = `${full}px`;
  s.elide(name, { position: 0.5, glyphs }, fast);
  await s.enter();
  await wait(200);
  await widen(b, full * 0.42, 700);
  await wait(250);
  await widen(b, full, 700, out);
  await wait(1700);
}

const script = [intro, position, lines, suffixes, snapping, tooltips, keeping, find, shared, lens, outro];

async function play() {
  for (const scene of script.slice(Number(params.get('scene') ?? 0))) await scene();
  Object.assign(window, { videoDone: true });
}

// ---------------------------------------------------------------------------
// Recording: the page's clock is the recorder's (timers, frames and
// performance.now()), and so are animations: each is paused and set to where
// it would be by that clock.

const born = new WeakMap<Animation, { at: number; from: number }>();

/** One frame of the recording: tweens step, the passes they cause run, and animations catch up. */
async function frame() {
  stepTweens();
  // The passes are queued as microtasks; animations they start are caught up after.
  await new Promise(queueMicrotask);
  await new Promise(queueMicrotask);
  syncAnimations();
}

function syncAnimations() {
  const now = performance.now();
  for (const a of document.getAnimations()) {
    if (a.playState === 'finished' || a.playState === 'idle') continue;
    let b = born.get(a);
    if (!b) {
      b = { at: now, from: Number(a.currentTime ?? 0) };
      born.set(a, b);
      a.pause();
    }
    const time = b.from + (now - b.at) * a.playbackRate;
    const end = a.effect?.getComputedTiming().endTime ?? 0;
    if (time >= Number(end)) a.finish();
    else a.currentTime = time;
  }
}

await Promise.all(
  [
    '400 40px Inter',
    '600 20px Inter',
    '400 54px "Instrument Serif"',
    'italic 400 54px "Instrument Serif"',
    '400 32px "JetBrains Mono"',
  ].map((font) => document.fonts.load(font)),
);
await document.fonts.ready;
Object.assign(window, { videoReady: true, videoPlay: play, videoFrame: frame });
if (!recording) void play();
