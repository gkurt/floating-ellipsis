import type { Elide, ElideChange, Part } from './elide.js';

export type Effect = 'none' | 'fade' | 'blur' | 'merge';

export interface TransitionOptions {
  /**
   * What glyphs do as they appear and disappear:
   * - 'merge' (default): a glyph that leaves shrinks into the nearest mark of
   *   the ellipsis and turns into it; one that arrives grows out of it
   * - 'fade': glyphs fade in and out in place
   * - 'blur': glyphs fade through a blur in place
   * - 'none': glyphs come and go at once; the marks still glide
   */
  effect?: Effect;
  /** Milliseconds for glyph effects, and roughly how long marks take to settle. Default 460. */
  duration?: number;
  /** For glyphs leaving; arriving glyphs play the same curve backwards. */
  easing?: string;
  /** Blur radius in px. Default 4. */
  blur?: number;
  /**
   * Let the ellipsis' marks glide to their new place when the cut changes
   * instead of jumping. They move on a critically damped spring: velocity
   * carries over when the target moves again, and they never overshoot.
   * Default true.
   */
  glide?: boolean;
  /**
   * How long glyphs take to leave:
   * - 'leeway' (default): in proportion to the room their removal frees. When
   *   text is squeezed hard (a fast drag), removing a glyph frees almost
   *   nothing and there is nowhere to animate into, so it goes at once.
   * - 'fixed': always `duration`.
   */
  pace?: 'leeway' | 'fixed';
  /**
   * When the marks move as glyphs leave: 'together' (default) with them, or
   * 'after' they have merged, so the dots only spread into the freed space
   * once it is empty.
   */
  marks?: 'together' | 'after';
  /** Skip animations when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
}

interface Ghost {
  el: HTMLSpanElement;
  anims: Animation[];
  /** Element the ghost rides on: the glyph it reveals, or the ellipsis it merges into. */
  follow: HTMLElement;
  /** Offset from the followed element's top-left corner. */
  dx: number;
  dy: number;
  /** Runs once the ghost is done, finished or cancelled. */
  cleanup?: () => void;
}

/** A mark's visual offset from where layout puts it, settling to zero. */
interface Spring {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Don't start settling before this time (for `marks: 'after'`). */
  hold: number;
}

type Before = { box: DOMRect; ink: DOMRect };

const center = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const;

/** The same curve played backwards: cubic-bezier(a, b, c, d) → (1 - c, 1 - d, 1 - a, 1 - b). */
function reversed(easing: string): string {
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(easing.trim());
  const v = m?.[1]!.split(',').map(Number);
  if (!v || v.length !== 4 || v.some((n) => !Number.isFinite(n))) return easing;
  const [a, b, c, d] = v as [number, number, number, number];
  return `cubic-bezier(${1 - c},${1 - d},${1 - a},${1 - b})`;
}

/**
 * Advance a critically damped spring by `dt` seconds, exactly:
 * x(t) = (x0 + (v0 + ωx0)t)e^(-ωt). Critical damping is the fastest motion
 * that doesn't oscillate; it can still cross zero once when it starts out
 * moving fast towards it, so a crossing stops it dead.
 */
function settle(x: number, v: number, omega: number, dt: number): [number, number] {
  const decay = Math.exp(-omega * dt);
  const k = v + omega * x;
  const nx = (x + k * dt) * decay;
  const nv = (v - omega * k * dt) * decay;
  if (x !== 0 && Math.sign(nx) !== Math.sign(x)) return [0, 0];
  return [nx, nv];
}

/** Below this, an animation isn't worth showing. */
const INSTANT = 60;

/**
 * Animate truncation changes: glyphs that appear and disappear (with an
 * instance created with `glyphs: true`) and the ellipsis' marks, which glide
 * to their new place (any instance). Returns a function that stops it all.
 *
 * Nothing here moves the text itself: glyphs keep their layout positions, so
 * the line always ends exactly at the edge. Ghost glyphs live in an overlay
 * next to the text, never inside it, since anything positioned inside the
 * line would disturb its measurement. Marks glide with a transform, which is
 * visual only, and are kept inside the content box while they do.
 */
export function transitions(instance: Elide, options: TransitionOptions = {}): () => void {
  const {
    effect = 'merge',
    duration = 460,
    easing = 'cubic-bezier(.45,0,.2,1)',
    blur = 4,
    glide = true,
    pace = 'leeway',
    marks: markTiming = 'together',
    respectReducedMotion = true,
  } = options;
  const host = instance.element;
  const ghosts = new Set<Ghost>();
  const entering = new Map<HTMLElement, Ghost>();
  const springs = new Map<HTMLElement, Spring>();
  // Where layout put each mark after the previous pass, relative to the host.
  let laidOut = new Map<HTMLElement, [number, number]>();
  // Settles to within 1% in about `duration`.
  const omega = 6.6 / (duration / 1000);
  let springFrame = 0;
  let lastTick = 0;

  const reduced = () => respectReducedMotion && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Absolutely positioned without offsets, the layer sits at the start of the
  // host's content, whatever the host's own positioning.
  const layer = document.createElement('span');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('data-fp-ghosts', '');
  layer.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
  host.prepend(layer);

  // ---------------------------------------------------------------------------
  // Marks

  // The transform each mark has on screen right now.
  const applied = new WeakMap<HTMLElement, { x: number; y: number }>();
  const offsetOf = (el: HTMLElement) => applied.get(el) ?? { x: 0, y: 0 };

  /** Mark positions as laid out, without any glide offset, relative to the host. */
  function layoutPositions(): Map<HTMLElement, [number, number]> {
    const origin = host.getBoundingClientRect();
    const out = new Map<HTMLElement, [number, number]>();
    instance.state.hidden.forEach((_, j) => {
      for (const el of instance.markElements(j)) {
        const r = el.getBoundingClientRect();
        const o = offsetOf(el);
        out.set(el, [r.left - o.x - origin.left, r.top - o.y - origin.top]);
      }
    });
    return out;
  }

  /** The bounds marks must stay within: the host's content box. */
  function contentBox() {
    const r = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const left = r.left + host.clientLeft + parseFloat(cs.paddingLeft);
    return { left, right: r.left + host.clientLeft + host.clientWidth - parseFloat(cs.paddingRight) };
  }

  function applySprings() {
    const bounds = contentBox();
    for (const [el, s] of springs) {
      if (!el.isConnected) {
        springs.delete(el);
        applied.delete(el);
        el.style.transform = '';
        continue;
      }
      // Keep the line's ends where they belong: never drawn past the edges.
      // Only the drawing is clamped; the spring itself carries on.
      const r = el.getBoundingClientRect();
      const layoutLeft = r.left - offsetOf(el).x;
      const x = Math.max(bounds.left - layoutLeft, Math.min(s.x, bounds.right - (layoutLeft + r.width)));
      const still = Math.abs(x) < 0.05 && Math.abs(s.y) < 0.05;
      applied.set(el, still ? { x: 0, y: 0 } : { x, y: s.y });
      el.style.transform = still ? '' : `translate(${x}px, ${s.y}px)`;
    }
  }

  function tick(now: number) {
    springFrame = 0;
    const dt = Math.min(0.05, lastTick ? (now - lastTick) / 1000 : 1 / 60);
    lastTick = now;
    for (const [el, s] of springs) {
      if (now < s.hold) continue;
      [s.x, s.vx] = settle(s.x, s.vx, omega, dt);
      [s.y, s.vy] = settle(s.y, s.vy, omega, dt);
      if (Math.abs(s.x) < 0.05 && Math.abs(s.y) < 0.05 && Math.abs(s.vx) < 1 && Math.abs(s.vy) < 1) {
        springs.delete(el);
        applied.delete(el);
        el.style.transform = '';
      }
    }
    applySprings();
    if (springs.size) springFrame = requestAnimationFrame(tick);
    else lastTick = 0;
  }

  /**
   * Layout just moved the marks (a glyph came or went). Keep them where they
   * were on screen and let them glide over, carrying their current velocity.
   */
  function glideMarks(hold: number) {
    const now = layoutPositions();
    for (const [el, [x, y]] of now) {
      const before = laidOut.get(el);
      if (!before) continue;
      const dx = before[0] - x;
      const dy = before[1] - y;
      if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) continue;
      // A mark that changed lines just goes there; gliding across lines reads as noise.
      if (Math.abs(dy) > el.getBoundingClientRect().height * 2) continue;
      const s = springs.get(el) ?? { x: 0, y: 0, vx: 0, vy: 0, hold: 0 };
      s.x += dx;
      s.y += dy;
      s.hold = Math.max(s.hold, hold);
      springs.set(el, s);
    }
    if (springs.size) {
      applySprings();
      springFrame ||= requestAnimationFrame(tick);
    }
  }

  // ---------------------------------------------------------------------------
  // Ghosts

  function place() {
    const origin = layer.getBoundingClientRect();
    // Read everything, then write, so layout is computed once.
    const boxes = [...ghosts].map((g) => (g.follow.isConnected ? g.follow.getBoundingClientRect() : null));
    let i = 0;
    for (const g of ghosts) {
      const box = boxes[i++];
      if (!box) continue; // e.g. the ellipsis went away with the truncation; stay put
      g.el.style.left = `${box.left + g.dx - origin.left}px`;
      g.el.style.top = `${box.top + g.dy - origin.top}px`;
    }
  }

  function track(ghost: Ghost) {
    ghosts.add(ghost);
    let open = ghost.anims.length;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      ghost.anims.forEach((a) => a.cancel());
      ghost.el.remove();
      ghosts.delete(ghost);
      ghost.cleanup?.();
    };
    for (const a of ghost.anims) {
      a.addEventListener('finish', () => --open <= 0 && end());
      a.addEventListener('cancel', end);
    }
  }

  /** A copy of a glyph over `box`: a wrapper (moves, changes colour) around its text. */
  function ghostOf(text: string, box: DOMRect, style: CSSStyleDeclaration, color: string) {
    const el = document.createElement('span');
    el.style.cssText = `position:absolute;margin:0;width:${box.width}px;height:${box.height}px;color:${color}`;
    const inner = document.createElement('span');
    // `font` resets line-height, so it goes first.
    inner.style.cssText =
      `display:block;white-space:pre;font:${style.font};line-height:${box.height}px;letter-spacing:${style.letterSpacing}`;
    inner.textContent = text;
    el.append(inner);
    layer.append(el);
    return { el, inner };
  }

  /**
   * Play a glyph turning into a mark of the ellipsis (or back, when
   * `backwards`): it shrinks onto the mark, takes the ellipsis' colour and
   * cross-fades into the mark's shape.
   */
  function morph(
    ghost: { el: HTMLSpanElement; inner: HTMLSpanElement },
    box: DOMRect,
    ink: DOMRect,
    mark: DOMRect,
    colors: [text: string, mark: string],
    ms: number,
    backwards: boolean,
  ): Animation[] {
    const [ix, iy] = center(ink);
    const [mx, my] = center(mark);
    const ox = ix - box.left;
    const oy = iy - box.top;
    const scale = Math.min(1, Math.max(0.04, Math.max(mark.width, mark.height) / Math.max(1, ink.width, ink.height)));
    ghost.el.style.transformOrigin = `${ox}px ${oy}px`;

    const style = instance.markStyle;
    const shapeName = typeof style === 'string' ? 'dot' : style.shape;
    const w = mark.width / scale;
    const h = mark.height / scale;
    const shape = document.createElement('span');
    shape.style.cssText =
      `position:absolute;left:${ox - w / 2}px;top:${oy - h / 2}px;width:${w}px;height:${h}px;opacity:0;` +
      `border-radius:${shapeName === 'square' ? 0 : '50%'};` +
      (shapeName === 'ring' ? `box-sizing:border-box;border:${Math.max(1, w * 0.16)}px solid currentColor` : 'background:currentColor');
    ghost.el.append(shape);

    const timing: KeyframeAnimationOptions = {
      duration: ms,
      easing: backwards ? reversed(easing) : easing,
      direction: backwards ? 'reverse' : 'normal',
      fill: 'both',
    };
    return [
      ghost.el.animate(
        [
          { transform: 'none', color: colors[0], filter: 'blur(0px)' },
          { offset: 0.5, color: colors[1] },
          { transform: `translate(${mx - ix}px, ${my - iy}px) scale(${scale})`, color: colors[1], filter: `blur(${blur / 8}px)` },
        ],
        timing,
      ),
      ghost.inner.animate([{ opacity: 1 }, { offset: 0.55, opacity: 1 }, { opacity: 0 }], timing),
      shape.animate([{ opacity: 0 }, { offset: 0.55, opacity: 0 }, { opacity: 1 }], timing),
    ];
  }

  /** The mark a grapheme maps to, by where it sits in its hidden part. */
  function markOf(i: number, part: Part, marks: DOMRect[]): DOMRect | undefined {
    const at = (i - part.start + 0.5) / Math.max(1, part.end - part.start);
    return marks[Math.min(marks.length - 1, Math.floor(at * marks.length))];
  }

  /** The mark a newly shown glyph grows out of, as it is on screen. */
  function sourceMark(i: number, change: ElideChange): DOMRect | undefined {
    const was = change.previous?.hidden.findIndex((p) => i >= p.start && i < p.end) ?? -1;
    const prev = change.previous?.hidden[was];
    if (!prev) return undefined;
    // The part it came from usually still exists, a little smaller.
    const match = change.state.hidden
      .map((p, j) => ({ p, j }))
      .filter(({ p }) => p.start < prev.end && p.end > prev.start)
      .sort((a, b) => Math.abs((a.p.start + a.p.end) / 2 - i) - Math.abs((b.p.start + b.p.end) / 2 - i))[0];
    if (match) {
      const marks = instance.marks(match.j);
      return i < match.p.start ? marks[0] : marks[marks.length - 1];
    }
    return markOf(i, prev, change.marksBefore[was] ?? []);
  }

  /** Marks of ellipsis `j` where they will come to rest. */
  function restingMarks(j: number): DOMRect[] {
    const els = instance.markElements(j);
    const boxes = instance.marks(j);
    // One element may draw several dots (a single '…'): they share its offset.
    return boxes.map((r, k) => {
      const o = offsetOf(els[els.length === boxes.length ? k : 0] ?? els[0]!);
      return new DOMRect(r.left - o.x, r.top - o.y, r.width, r.height);
    });
  }

  const fadeFrames = (): Keyframe[] => [
    effect === 'blur' ? { opacity: 0, filter: `blur(${blur * 1.5}px)` } : { opacity: 0 },
    { opacity: 1, filter: 'blur(0px)' },
  ];

  function enter(i: number, change: ElideChange) {
    const el = instance.glyph(i);
    const ink = instance.glyphInk(i);
    if (!el || !ink) return;
    entering.get(el)?.anims.forEach((a) => a.cancel());
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    let anims: Animation[];
    const ghost = ghostOf(instance.graphemes[i] ?? '', box, style, style.color);
    if (effect === 'merge') {
      const mark = sourceMark(i, change);
      if (!mark) {
        ghost.el.remove();
        return;
      }
      const markColor = getComputedStyle(instance.ellipsisElement).color;
      anims = morph(ghost, box, ink, mark, [style.color, markColor], duration, true);
    } else {
      anims = [ghost.el.animate(fadeFrames(), { duration, easing })];
    }
    el.style.color = 'transparent';
    const g: Ghost = {
      el: ghost.el,
      anims,
      follow: el,
      dx: 0,
      dy: 0,
      cleanup: () => {
        el.style.color = '';
        if (entering.get(el) === g) entering.delete(el);
      },
    };
    entering.set(el, g);
    track(g);
  }

  function leave(i: number, before: Before, change: ElideChange, ms: number) {
    const j = change.state.hidden.findIndex((p) => i >= p.start && i < p.end);
    const part = change.state.hidden[j];
    const follow = instance.ellipses[j];
    const anchor = instance.ellipsisRect(j);
    if (!part || !follow || !anchor) return;
    const { box, ink } = before;
    // The glyph is gone from the DOM; its join carries the same text style.
    const style = getComputedStyle(follow.parentElement ?? host);
    const ghost = ghostOf(instance.graphemes[i] ?? '', box, style, style.color);
    let anims: Animation[];
    if (effect === 'merge') {
      const mark = markOf(i, part, restingMarks(j));
      if (!mark) {
        ghost.el.remove();
        return;
      }
      const markColor = getComputedStyle(instance.ellipsisElement).color;
      anims = morph(ghost, box, ink, mark, [style.color, markColor], ms, false);
    } else {
      anims = [ghost.el.animate(fadeFrames(), { duration: ms, easing, direction: 'reverse', fill: 'both' })];
    }
    track({ el: ghost.el, anims, follow, dx: box.left - anchor.left, dy: box.top - anchor.top });
  }

  /**
   * Fade a new ellipsis in through a ghost: animating the element itself is
   * fragile, since fitting may briefly move it, which restarts animations.
   */
  function appear(j: number) {
    const real = instance.ellipses[j];
    const rect = instance.ellipsisRect(j);
    if (!real || !rect) return;
    const style = getComputedStyle(real);
    const ghost = ghostOf('', rect, style, style.color);
    ghost.inner.replaceChildren(...Array.from(real.childNodes, (n) => n.cloneNode(true)));
    real.style.visibility = 'hidden';
    track({
      el: ghost.el,
      anims: [ghost.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing })],
      follow: real,
      dx: 0,
      dy: 0,
      cleanup: () => (real.style.visibility = ''),
    });
  }

  /**
   * How long leaving glyphs get. Removing glyphs frees their width, minus
   * whatever the text was overflowing by; what is left over is the room the
   * animation has. Little room means the text is squeezed: be quick.
   */
  function leaveTime(change: ElideChange): number {
    if (pace === 'fixed' || !change.hidden.length || change.shown.length) return duration * 0.85;
    let removed = 0;
    for (const i of change.hidden) removed += change.hiddenGlyphs.get(i)?.box.width ?? 0;
    if (!removed) return duration * 0.85;
    const leeway = Math.min(1, Math.max(0, change.state.slack / removed));
    return duration * 0.85 * leeway;
  }

  const offChange = instance.onChange((change: ElideChange) => {
    // Glyphs hidden mid-entrance stop entering.
    for (const i of change.hidden) {
      const el = instance.glyph(i);
      if (el) entering.get(el)?.anims.forEach((a) => a.cancel());
    }
    if (change.reset || !change.previous || reduced()) return;

    const ms = leaveTime(change);
    const instant = ms < INSTANT;
    const leaving = change.hidden.length > 0 && effect !== 'none' && !instant;
    if (glide) glideMarks(markTiming === 'after' && leaving && effect === 'merge' ? performance.now() + ms * 0.8 : 0);
    if (effect === 'none') return;

    for (const i of change.shown) enter(i, change);
    if (leaving) {
      for (const i of change.hidden) {
        const before = change.hiddenGlyphs.get(i);
        if (before) leave(i, before, change, ms);
      }
    }
    for (let j = change.previous.hidden.length; j < change.state.hidden.length; j++) appear(j);
    if (ghosts.size) place();
  });

  // After every pass, with layout final for this frame: put ghosts back on
  // the elements they follow, and remember where layout put the marks, so a
  // jump can be told apart from the gentle drift of resizing (no glide).
  // (Doing this in a frame callback would see the old text reflowed at the
  // new width, before truncation catches up, often a line lower.)
  const offRender = instance.onRender(() => {
    if (ghosts.size) place();
    laidOut = layoutPositions();
    if (springs.size) applySprings();
  });
  laidOut = layoutPositions();

  return () => {
    offChange();
    offRender();
    for (const g of [...ghosts]) g.anims.forEach((a) => a.cancel());
    for (const el of springs.keys()) {
      el.style.transform = '';
      applied.delete(el);
    }
    springs.clear();
    cancelAnimationFrame(springFrame);
    layer.remove();
  };
}
