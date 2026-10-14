import type { Elide, ElideChange, Part } from './elide.ts';
import { isWhitespace } from './graphemes.ts';

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
  /** Milliseconds for glyph effects, and roughly how long the spacing takes to settle. Default 460. */
  duration?: number;
  /** For glyphs leaving; arriving glyphs play the same curve backwards. */
  easing?: string;
  /** Blur radius in px. Default 4. */
  blur?: number;
  /**
   * When the cut changes, let the ellipsis' spacing glide instead of jump.
   * The marks always sit evenly in the space between their neighbouring
   * glyphs; it is that space's edges that glide, on a critically damped
   * spring (velocity carries over when the target moves again, and it never
   * overshoots). Since the marks never leave that space, they can't run into
   * the text. Default true.
   */
  glide?: boolean;
  /**
   * How long glyphs take to leave:
   * - 'leeway' (default): shorter the less room and time there is. Room: a
   *   glyph leaving gets time in proportion to the space its removal frees;
   *   squeezed text frees almost nothing. Time: when changes come faster than
   *   animations can play (a dragged slider, a fast resize), each gets a few
   *   times the gap since the previous one. With no leeway, glyphs come and
   *   go at once and anything still in flight lands immediately.
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

/**
 * How far an ellipsis' region (the space between its neighbouring glyphs)
 * is drawn from where layout puts it, edge by edge, settling to zero.
 */
interface Region {
  left: number;
  right: number;
  vLeft: number;
  vRight: number;
  /** Don't start settling before this time (for `marks: 'after'`). */
  hold: number;
}

/** An ellipsis' region and its marks, relative to the host. */
interface Geometry {
  ellipsis: HTMLElement;
  /** The region as laid out: from the ink of the glyph before to the ink of the glyph after. */
  left: number;
  right: number;
  top: number;
  /** Each mark element with the horizontal extent of its ink, as laid out. */
  marks: { el: HTMLElement; left: number; right: number }[];
  /** Grapheme indices of the neighbouring glyphs (may be out of range). */
  before: number;
  after: number;
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
 * instance created with `glyphs: true`) and the ellipsis' spacing, which
 * glides (any instance). Returns a function that stops it all.
 *
 * Nothing here moves the text itself: glyphs keep their layout positions, so
 * the line always ends exactly at the edge. Ghost glyphs live in an overlay
 * next to the text, never inside it, since anything positioned inside the
 * line would disturb its measurement. Marks are shifted with a transform,
 * which is visual only, and only ever within the space between their
 * neighbouring glyphs.
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
  const regions = new Map<HTMLElement, Region>();
  // Each ellipsis' region as drawn last, relative to the host.
  let drawn = new Map<HTMLElement, { left: number; right: number; top: number }>();
  // Settles to within 1% in about `duration`.
  const omega = 6.6 / (duration / 1000);
  let springFrame = 0;
  let lastTick = 0;
  let lastChange = -Infinity;

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

  // The horizontal shift each mark has on screen right now.
  const applied = new WeakMap<HTMLElement, number>();
  const shiftOf = (el: HTMLElement) => applied.get(el) ?? 0;

  /** Every showing ellipsis' region and marks as laid out, without glide shifts. */
  function geometry(): Geometry[] {
    const origin = host.getBoundingClientRect();
    const { hidden, gaps } = instance.state;
    return hidden.flatMap((_, j) => {
      const ellipsis = instance.ellipses[j];
      const els = instance.markElements(j);
      const boxes = instance.marks(j);
      const gap = gaps[j];
      if (!ellipsis || els.length === 0 || boxes.length === 0 || !gap) return [];
      // One element may draw several dots (a single '…'): they share its shift.
      const owner = (k: number) => els[els.length === boxes.length ? k : 0]!;
      const ink = boxes.map((r, k) => {
        const x = shiftOf(owner(k));
        return { left: r.left - x - origin.left, right: r.right - x - origin.left, el: owner(k) };
      });
      const first = ink[0]!;
      const last = ink[ink.length - 1]!;
      const marks = els.map((el) => {
        const own = ink.filter((b) => b.el === el);
        return { el, left: Math.min(...own.map((b) => b.left)), right: Math.max(...own.map((b) => b.right)) };
      });
      return [
        {
          ellipsis,
          left: first.left - (gap.left ?? 0),
          right: last.right + (gap.right ?? 0),
          top: boxes[0]!.top - origin.top,
          marks,
          before: hidden[j]!.start - 1,
          after: hidden[j]!.end,
        },
      ];
    });
  }

  /** The host's content box, relative to the host. */
  function contentBox() {
    const r = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const left = host.clientLeft + parseFloat(cs.paddingLeft);
    return { left, right: host.clientLeft + host.clientWidth - parseFloat(cs.paddingRight), width: r.width };
  }

  /**
   * Draw every ellipsis. Its region's edges sit where their springs are, but
   * never past a glyph that is showing (nor the content box), and never
   * closer together than the marks need. The marks are laid out inside it
   * with every gap scaled alike, so what animates is the spacing, and the
   * marks can't run into the text or into each other.
   */
  function draw() {
    const bounds = contentBox();
    const next = new Map<HTMLElement, { left: number; right: number; top: number }>();
    // An edge may only reach past where layout puts it while the glyph there
    // is still on its way in (hidden, its ghost growing).
    const arriving = (i: number) => {
      const el = instance.glyph(i);
      return !!el && entering.has(el);
    };
    const n = instance.state.length;
    for (const g of geometry()) {
      const r = regions.get(g.ellipsis);
      const showingBefore = g.before >= 0 && !arriving(g.before);
      const showingAfter = g.after < n && !arriving(g.after);
      if (r && r.left < 0 && showingBefore) [r.left, r.vLeft] = [0, 0];
      if (r && r.right > 0 && showingAfter) [r.right, r.vRight] = [0, 0];
      const hardLeft = showingBefore ? g.left : bounds.left;
      const hardRight = showingAfter ? g.right : bounds.right;

      const widths = g.marks.map((m) => m.right - m.left);
      const need = widths.reduce((sum, w) => sum + w, 0);
      let left = Math.max(hardLeft, g.left + (r?.left ?? 0));
      let right = Math.min(hardRight, g.right + (r?.right ?? 0));
      if (right - left < need) {
        // Too tight for the marks: widen around the middle, within bounds.
        const middle = (left + right) / 2;
        left = Math.max(hardLeft, middle - need / 2);
        right = Math.min(hardRight, left + need);
        left = Math.max(hardLeft, right - need);
      }
      next.set(g.ellipsis, { left, right, top: g.top });

      // Layout's gaps (outer and between marks), scaled to the drawn region.
      const free = g.right - g.left - need;
      const scale = free > 0.01 ? Math.max(0, right - left - need) / free : 1;
      let x = left + (g.marks[0]!.left - g.left) * scale;
      g.marks.forEach((m, k) => {
        const shift = r ? x - m.left : 0;
        x += widths[k]! + ((g.marks[k + 1]?.left ?? m.right) - m.right) * scale;
        const still = Math.abs(shift) < 0.05;
        applied.set(m.el, still ? 0 : shift);
        m.el.style.transform = still ? '' : `translateX(${shift}px)`;
      });
    }
    drawn = next;
  }

  function tick(now: number) {
    springFrame = 0;
    const dt = Math.min(0.05, lastTick !== 0 ? (now - lastTick) / 1000 : 1 / 60);
    lastTick = now;
    for (const [el, r] of regions) {
      if (!el.isConnected) {
        regions.delete(el);
        continue;
      }
      if (now < r.hold) continue;
      [r.left, r.vLeft] = settle(r.left, r.vLeft, omega, dt);
      [r.right, r.vRight] = settle(r.right, r.vRight, omega, dt);
      const done = (x: number, v: number) => Math.abs(x) < 0.05 && Math.abs(v) < 1;
      if (done(r.left, r.vLeft) && done(r.right, r.vRight)) regions.delete(el);
    }
    draw();
    if (regions.size > 0) springFrame = requestAnimationFrame(tick);
    else lastTick = 0;
  }

  /**
   * Layout just moved an ellipsis' neighbours (a glyph came or went). Keep
   * its region where it was on screen and let the edges glide over,
   * carrying their current velocity.
   */
  function glideMarks(hold: number) {
    for (const g of geometry()) {
      const before = drawn.get(g.ellipsis);
      // An ellipsis that changed lines just goes there; gliding across lines reads as noise.
      if (!before || Math.abs(before.top - g.top) > 2) continue;
      const left = before.left - g.left;
      const right = before.right - g.right;
      if (Math.abs(left) < 0.25 && Math.abs(right) < 0.25) continue;
      const r = regions.get(g.ellipsis) ?? { left: 0, right: 0, vLeft: 0, vRight: 0, hold: 0 };
      r.left = left;
      r.right = right;
      r.hold = Math.max(r.hold, hold);
      regions.set(g.ellipsis, r);
    }
    draw();
    if (regions.size > 0) springFrame ||= requestAnimationFrame(tick);
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
    inner.style.cssText = `display:block;white-space:pre;font:${style.font};line-height:${box.height}px;letter-spacing:${style.letterSpacing}`;
    inner.textContent = text;
    el.append(inner);
    layer.append(el);
    return { el, inner };
  }

  /**
   * Play a glyph turning into a mark of the ellipsis (or back, when
   * `backwards`): it shrinks onto the mark, takes the ellipsis' colour and
   * cross-fades into the mark's shape. Whitespace has no ink to turn into
   * anything: it only keeps the timing.
   */
  function morph(
    text: string,
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
    const markSize = Math.max(mark.width, mark.height);
    const inkSize = Math.max(1, ink.width, ink.height);
    const scale = Math.min(1, Math.max(0.04, markSize / inkSize));
    ghost.el.style.transformOrigin = `${ox}px ${oy}px`;

    const timing: KeyframeAnimationOptions = {
      duration: ms,
      easing: backwards ? reversed(easing) : easing,
      direction: backwards ? 'reverse' : 'normal',
      fill: 'both',
    };
    const travel = ghost.el.animate(
      [
        { transform: 'none', color: colors[0], filter: 'blur(0px)' },
        { offset: 0.5, color: colors[1] },
        { transform: `translate(${mx - ix}px, ${my - iy}px) scale(${scale})`, color: colors[1], filter: `blur(${blur / 8}px)` },
      ],
      timing,
    );
    if (isWhitespace(text)) return [travel];

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
    // The shape shrinks with the glyph, but starts no bigger than the
    // glyph's narrow side: a comma or an `l` is tall, not wide.
    const start = Math.min(1, Math.max(Math.min(ink.width, ink.height), markSize) / inkSize);

    return [
      travel,
      ghost.inner.animate([{ opacity: 1 }, { offset: 0.55, opacity: 1 }, { opacity: 0 }], timing),
      shape.animate(
        [
          { opacity: 0, transform: `scale(${start})` },
          { offset: 0.55, opacity: 0 },
          { opacity: 1, transform: 'none' },
        ],
        timing,
      ),
    ];
  }

  /** The mark a grapheme maps to, by where it sits in its hidden part. */
  function markOf(i: number, part: Part, marks: DOMRect[]): DOMRect | undefined {
    const at = (i - part.start + 0.5) / Math.max(1, part.end - part.start);
    return marks[Math.min(marks.length - 1, Math.floor(at * marks.length))];
  }

  /** An ellipsis with no marks is a gap: things merge into its middle. */
  function gapPoint(j: number): DOMRect | undefined {
    const r = instance.ellipsisRect(j);
    return r ? new DOMRect(r.left + r.width / 2, r.top + r.height / 2, 0, 0) : undefined;
  }

  /** The mark a newly shown glyph grows out of, as it was last painted. */
  function sourceMark(i: number, change: ElideChange): DOMRect | undefined {
    const was = change.previous?.hidden.findIndex((p) => i >= p.start && i < p.end) ?? -1;
    const prev = change.previous?.hidden[was];
    if (!prev) return undefined;
    const marks = change.marksBefore[was] ?? [];
    // The part it came from usually still exists, a little smaller: the
    // glyph comes out of the end of the ellipsis on its side.
    const match = change.state.hidden.findIndex((p) => p.start < prev.end && p.end > prev.start);
    if (marks.length === 0) return match >= 0 ? gapPoint(match) : undefined;
    const part = change.state.hidden[match];
    if (part) return i < part.start ? marks[0] : marks[marks.length - 1];
    return markOf(i, prev, marks);
  }

  /** Marks of ellipsis `j` where they will come to rest. */
  function restingMarks(j: number): DOMRect[] {
    const els = instance.markElements(j);
    const boxes = instance.marks(j);
    // One element may draw several dots (a single '…'): they share its shift.
    return boxes.map((r, k) => {
      const x = shiftOf(els[els.length === boxes.length ? k : 0] ?? els[0]!);
      return new DOMRect(r.left - x, r.top, r.width, r.height);
    });
  }

  const fadeFrames = (): Keyframe[] => [
    effect === 'blur' ? { opacity: 0, filter: `blur(${blur * 1.5}px)` } : { opacity: 0 },
    { opacity: 1, filter: 'blur(0px)' },
  ];

  function enter(i: number, change: ElideChange, ms: number) {
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
      anims = morph(instance.graphemes[i] ?? '', ghost, box, ink, mark, [style.color, markColor], ms, true);
    } else {
      anims = [ghost.el.animate(fadeFrames(), { duration: ms, easing })];
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
      const mark = markOf(i, part, restingMarks(j)) ?? gapPoint(j);
      if (!mark) {
        ghost.el.remove();
        return;
      }
      const markColor = getComputedStyle(instance.ellipsisElement).color;
      anims = morph(instance.graphemes[i] ?? '', ghost, box, ink, mark, [style.color, markColor], ms, false);
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
   * How long leaving glyphs get, by room. Removing glyphs frees their width, minus
   * whatever the text was overflowing by; what is left over is the room the
   * animation has. Little room means the text is squeezed (a fast drag, a
   * jump in position): be quick, down to nothing.
   */
  function leaveTime(change: ElideChange): number {
    if (pace === 'fixed' || change.hidden.length === 0) return duration * 0.85;
    let removed = 0;
    for (const i of change.hidden) removed += change.hiddenGlyphs.get(i)?.box.width ?? 0;
    if (removed === 0) return duration * 0.85;
    const leeway = Math.min(1, Math.max(0, change.state.slack / removed));
    return duration * 0.85 * leeway;
  }

  /**
   * How long arriving glyphs get. Glyphs that arrive together come out of the
   * same mark, so a run of them would start out stacked on top of each other:
   * the longer the run, the quicker they go. When glyphs also leave in the
   * same change (the position moved), they share its leeway.
   */
  function enterTime(change: ElideChange): number {
    if (pace === 'fixed' || change.shown.length === 0) return duration;
    if (change.hidden.length > 0) return leaveTime(change) / 0.85;
    let run = 1;
    let longest = 1;
    for (let k = 1; k < change.shown.length; k++) {
      run = change.shown[k] === change.shown[k - 1]! + 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    return duration / longest;
  }

  const offChange = instance.onChange((change: ElideChange) => {
    // Glyphs hidden mid-entrance stop entering.
    for (const i of change.hidden) {
      const el = instance.glyph(i);
      if (el) entering.get(el)?.anims.forEach((a) => a.cancel());
    }
    if (change.reset || !change.previous || reduced()) return;

    // Room is one limit; time is the other. When changes come faster than
    // their animations can play (a slider dragged, a fast resize), each gets
    // a few times the gap since the last one, and soon nothing at all.
    const now = performance.now();
    const cap = pace === 'fixed' ? Infinity : (now - lastChange) * 3;
    lastChange = now;
    const ms = Math.min(leaveTime(change), cap);
    const inMs = Math.min(enterTime(change), cap);
    const instant = ms < INSTANT;
    const leaving = change.hidden.length > 0 && effect !== 'none' && !instant;
    const arriving = change.shown.length > 0 && effect !== 'none' && inMs >= INSTANT;
    // No time for this change means the text is moving fast: anything still
    // in flight from earlier changes lands now too, rather than piling up.
    if ((change.hidden.length > 0 && instant) || (change.shown.length > 0 && !arriving))
      for (const g of Array.from(ghosts)) g.anims.forEach((a) => a.finish());

    // Arriving glyphs first: the spacing may only glide over glyphs still on their way in.
    if (arriving) for (const i of change.shown) enter(i, change, inMs);
    if (glide) glideMarks(markTiming === 'after' && leaving && effect === 'merge' ? performance.now() + ms * 0.8 : 0);
    if (effect === 'none') return;

    if (leaving) {
      for (const i of change.hidden) {
        const before = change.hiddenGlyphs.get(i);
        if (before) leave(i, before, change, ms);
      }
    }
    for (let j = change.previous.hidden.length; j < change.state.hidden.length; j++) appear(j);
    if (ghosts.size > 0) place();
  });

  // After every pass, with layout final for this frame: put ghosts back on
  // the elements they follow, and redraw the ellipses. A region's glide
  // offsets are relative to layout, so the gentle drift of resizing is
  // followed directly; only jumps glide.
  // (Doing this in a frame callback would see the old text reflowed at the
  // new width, before truncation catches up, often a line lower.)
  const offRender = instance.onRender(() => {
    if (ghosts.size > 0) place();
    draw();
  });
  draw();

  return () => {
    offChange();
    offRender();
    for (const g of Array.from(ghosts)) g.anims.forEach((a) => a.cancel());
    regions.clear();
    instance.state.hidden.forEach((_, j) => {
      for (const el of instance.markElements(j)) {
        el.style.transform = '';
        applied.delete(el);
      }
    });
    cancelAnimationFrame(springFrame);
    layer.remove();
  };
}
