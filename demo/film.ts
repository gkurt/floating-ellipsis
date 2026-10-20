import { glyphs } from '#src/glyphs.ts';
import { type Elide, type ElideOptions, elide } from '#src/index.ts';
import { type TooltipOptions, tooltip } from '#src/tooltip.ts';
import { type TransitionOptions, transitions } from '#src/transitions.ts';
import { type Row, code, fast } from './examples.ts';
import { $ } from './ui.ts';

/**
 * What the videos are made with: a 1280×720 frame playing a script of
 * scenes. A video plays in real time when opened; `scripts/video.ts` records
 * it frame by frame (`?record`) with the page's clock under its control.
 * `?scene=N` starts at scene N.
 */

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// Time

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
export const out = (k: number) => 1 - (1 - k) ** 3;

/** Tweens running, each stepped once a frame: by animation frames, or by the recorder. */
const tweens = new Set<(now: number) => void>();
const recording = params.has('record');

function stepTweens() {
  const now = performance.now();
  for (const step of tweens) step(now);
  if (!recording && tweens.size > 0) requestAnimationFrame(stepTweens);
}

/** Call `step` every frame for `ms`, with the eased progress. */
export function tween(ms: number, step: (k: number) => void, curve = smooth): Promise<void> {
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
export function widen(el: HTMLElement, to: number, ms: number, curve = smooth) {
  const from = el.getBoundingClientRect().width;
  return tween(ms, (k) => (el.style.width = `${lerp(from, to, k)}px`), curve);
}

// ---------------------------------------------------------------------------
// The pointer: drawn, and dispatching pointer events where it is, so tooltips see it.

const cursor = $('#cursor');
export const pointer = { x: 1180, y: 800 };

function hover() {
  cursor.style.translate = `${pointer.x - 5}px ${pointer.y - 3.5}px`;
  const target = document.elementFromPoint(pointer.x, pointer.y) ?? document.body;
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: pointer.x, clientY: pointer.y, pointerType: 'mouse' }));
  // (:hover can't be faked.)
  for (const row of document.querySelectorAll('.files li, .table .tr')) row.classList.toggle('hover', row.contains(target));
}

export function moveTo([x, y]: [number, number], ms: number) {
  const [x0, y0] = [pointer.x, pointer.y];
  return tween(ms, (k) => {
    pointer.x = lerp(x0, x, k);
    pointer.y = lerp(y0, y, k);
    hover();
  });
}

/** A point in an element's box, `fx` and `fy` of the way across. */
export function at(el: Element, fx = 0.5, fy = 0.5): [number, number] {
  const r = el.getBoundingClientRect();
  return [r.left + r.width * fx, r.top + r.height * fy];
}

export function showCursor(on: boolean) {
  return cursor.animate({ opacity: on ? [0, 1] : [1, 0] }, { duration: 200, fill: 'forwards' }).finished;
}

/** Press where the pointer is: `act` does what the press does. */
export async function press(act: () => void) {
  cursor.animate({ scale: [1, 0.86, 1] }, { duration: 220, easing: 'ease-out' });
  await wait(110);
  act();
  await wait(110);
}

export const click = (el: HTMLElement) => press(() => el.click());

// ---------------------------------------------------------------------------
// Scenes

const scenes = $('#scenes');
const counter = $('#counter');
let chapters = 0;

export class Scene {
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

  /** Run `fn` when the scene leaves. */
  cleanup(fn: () => void) {
    this.#cleanups.push(fn);
  }

  /**
   * Hold what the stage centers where it is now: what grows after this
   * grows down, rather than moving everything up by half as much.
   */
  pin() {
    const first = this.stage.firstElementChild;
    if (!(first instanceof HTMLElement)) return;
    const top = first.offsetTop - parseFloat(getComputedStyle(this.stage).paddingTop);
    this.stage.style.justifyContent = 'flex-start';
    first.style.marginTop = `${top}px`;
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

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  node.innerHTML = html;
  return node;
}

/** A box `width` px wide holding `children`; its right edge is drawn. */
export function box(width: number, ...children: Node[]) {
  const b = el('div', 'box');
  b.style.width = `${width}px`;
  b.append(...children);
  return b;
}

/** Labeled rows in a box, each line truncated by its options; the baseline ones muted. */
export function rows(s: Scene, list: readonly Row[], motion: TransitionOptions | null = null) {
  const made = el('div', 'rows box');
  const lines = list.map(({ label, text, mono, baseline, options }) => {
    const row = el('div', `row${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
    const line = el('p', mono ? 'line mono' : 'line', text);
    row.append(line);
    made.append(row);
    s.elide(line, options, motion);
    return line;
  });
  return { rows: made, lines };
}

/** The last scene of every video: the name, truncated and whole again, and where to get it. */
export async function outro() {
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

/** Play `script`, its scenes numbered out of `count`, once the fonts are in; or hand it to the recorder. */
export async function film(script: (() => Promise<void>)[], count: number) {
  chapters = count;
  const play = async () => {
    for (const scene of script.slice(Number(params.get('scene') ?? 0))) await scene();
    Object.assign(window, { videoDone: true });
  };
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
}
