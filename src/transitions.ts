import { type ElideChange, onChange } from './changes.ts';
import type { Elide } from './elide.ts';
import { ellipsisRect, markElements, markInks } from './geometry.ts';
import { glyph, glyphInk } from './glyphs.ts';
import { isWhitespace } from './graphemes.ts';
import type { Part } from './options.ts';

export type Effect = 'none' | 'fade' | 'blur' | 'merge';

export interface TransitionOptions {
  /**
   * What glyphs do as they appear and disappear:
   * - 'merge' (default): a glyph that leaves shrinks and fades into the
   *   ellipsis, taking its colour; one that arrives grows back out of it
   * - 'fade': glyphs fade in and out in place
   * - 'blur': glyphs fade through a blur in place
   * - 'none': glyphs come and go at once; the marks still glide
   *
   * Whatever the effect, a glyph on its way in or out never overlaps the
   * text, the marks or another glyph: it stays in its own place and only has
   * what is left of it, shrinking to fit (so squeezed, it merges faster),
   * and goes at once when nothing is left.
   */
  effect?: Effect;
  /**
   * Milliseconds for glyph effects, and roughly how long the spacing takes
   * to settle. Default 460. Arriving glyphs always take this long. Leaving
   * ones take less the less room and time there is: room, in proportion to
   * the space their removal frees (squeezed text frees almost nothing);
   * time, a few times the gap since the previous change when changes come
   * faster than they can play (a dragged slider, a fast resize). With no
   * time left, they go at once and anything still in flight lands.
   */
  duration?: number;
  /** How glyphs shrink and grow, as a CSS keyword or `cubic-bezier()`. */
  easing?: string;
  /** Blur radius in px. Default 4. */
  blur?: number;
  /**
   * When the truncation changes, let the ellipsis' spacing glide instead of jump.
   * The marks always sit evenly in the space between their neighbouring
   * glyphs; it is that space's edges that glide, on a critically damped
   * spring (velocity carries over when the target moves again, and it never
   * overshoots). Since the marks never leave that space, they can't run into
   * the text. Default true.
   */
  glide?: boolean;
  /** Skip animations when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
}

/** A new ellipsis fading in, drawn over it in the overlay. */
interface Fade {
  el: HTMLSpanElement;
  anim: Animation;
  /** The ellipsis it stands in for. */
  follow: HTMLElement;
}

/**
 * A glyph on its way out (or in), drawn in the overlay. Every frame it is
 * given the room between whatever is drawn around it, and shrinks to fit.
 */
interface Sprite {
  i: number;
  el: HTMLSpanElement;
  /** Leaving: the ellipsis it merges into, and which side of its marks it is on. */
  ellipsis: HTMLElement | null;
  side: 'left' | 'right';
  /** Arriving: the glyph it stands in for, drawn once it lands. */
  glyph: HTMLElement | null;
  /** Width of its ink at full size. */
  width: number;
  /** Arriving: its ink's left edge from its glyph box's. */
  inkDx: number;
  /**
   * Leaving: where the centre of its ink belongs, relative to the host, and
   * its distance from the text on its side, which it moves with. The
   * distance is taken afresh (`anchored` false) whenever that text changes.
   */
  home: number;
  x: number;
  anchored: boolean;
  /** Leaving: the top of its box from the top of the ellipsis' marks. */
  dy: number;
  /** Opacity it started at, and its size and opacity now. */
  from: number;
  scale: number;
  alpha: number;
  start: number;
  ms: number;
  colors: [text: string, ellipsis: string];
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
}

/** An ellipsis' region and its marks, relative to the host. */
interface Geometry {
  ellipsis: HTMLElement;
  /** The region as laid out: from the ink of the glyph before to the ink of the glyph after. */
  left: number;
  right: number;
  /** Vertical extent of its marks (of the ellipsis, with none). */
  top: number;
  bottom: number;
  /** Each mark element with the horizontal extent of its ink, as laid out. */
  marks: { el: HTMLElement; left: number; right: number }[];
  /** Grapheme indices of the neighbouring glyphs (may be out of range). */
  before: number;
  after: number;
}

type Before = { box: DOMRect; ink: DOMRect };

const KEYWORDS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** A CSS easing as a function of progress; anything but a keyword or `cubic-bezier()` is linear. */
function curve(easing: string): (x: number) => number {
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(easing.trim());
  const v = m ? m[1]!.split(',').map(Number) : KEYWORDS[easing.trim()];
  if (!v || v.length !== 4 || v.some((n) => !Number.isFinite(n))) return (x) => x;
  const [x1, y1, x2, y2] = v as [number, number, number, number];
  const at = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0 || x >= 1) return Math.min(1, Math.max(0, x));
    // x(t) only grows, so bisection always finds it.
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const t = (lo + hi) / 2;
      if (at(t, x1, x2) < x) lo = t;
      else hi = t;
    }
    return at((lo + hi) / 2, y1, y2);
  };
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
/** A merging glyph narrower than this (px) is gone. */
const SPECK = 0.75;

/**
 * Animate truncation changes: glyphs that appear and disappear (with an
 * instance in glyph mode: `elide(el, { glyphs })`) and the ellipsis' spacing, which
 * glides (any instance). Returns a function that stops it all.
 *
 * Nothing here moves the text itself: glyphs keep their layout positions, so
 * the line always ends exactly at the edge. Glyphs on their way in or out
 * are drawn in an overlay next to the text, never inside it, since anything
 * positioned inside the line would disturb its measurement. Marks are
 * shifted with a transform, which is visual only, and only ever within the
 * space between their neighbouring glyphs.
 */
export function transitions(instance: Elide, options: TransitionOptions = {}): () => void {
  const {
    effect = 'merge',
    duration = 460,
    easing = 'cubic-bezier(.45,0,.2,1)',
    blur = 4,
    glide = true,
    respectReducedMotion = true,
  } = options;
  const host = instance.element;
  const ease = curve(easing);
  const fades = new Set<Fade>();
  const leaving = new Map<number, Sprite>();
  const arriving = new Map<HTMLElement, Sprite>();
  const regions = new Map<HTMLElement, Region>();
  // Each ellipsis' region as drawn last, relative to the host.
  let drawn = new Map<HTMLElement, { left: number; right: number; top: number }>();
  // Settles to within 1% in about `duration`.
  const omega = 6.6 / (duration / 1000);
  let frame = 0;
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
    return hidden.flatMap((part, j) => {
      const ellipsis = instance.ellipses[j];
      if (!ellipsis) return [];
      const els = markElements(instance, j);
      const boxes = markInks(instance, j);
      const gap = gaps[j];
      if (els.length === 0 || boxes.length === 0 || !gap) {
        // No marks: a gap, which glyphs merge into the middle of.
        const r = ellipsisRect(instance, j);
        if (!r) return [];
        const [left, right, top, bottom] = [r.left - origin.left, r.right - origin.left, r.top - origin.top, r.bottom - origin.top];
        return [{ ellipsis, left, right, top, bottom, marks: [], before: part.start - 1, after: part.end }];
      }
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
          bottom: boxes[0]!.bottom - origin.top,
          marks,
          before: part.start - 1,
          after: part.end,
        },
      ];
    });
  }

  /** The host's content box, relative to the host. */
  function contentBox() {
    const cs = getComputedStyle(host);
    const left = host.clientLeft + parseFloat(cs.paddingLeft);
    return { left, right: host.clientLeft + host.clientWidth - parseFloat(cs.paddingRight) };
  }

  /**
   * Draw every ellipsis, then the glyphs on their way in or out around it.
   * Its marks stay centred where layout puts them, and only the spacing
   * between them animates: the region's width, as its springs have it,
   * spreads them with every gap scaled alike. Next to a glyph that is
   * showing they keep at least half the gap layout gives them, so they
   * can't crowd the text, nor run into each other.
   */
  function draw(now = performance.now()) {
    const bounds = contentBox();
    const geo = geometry();
    const sprites = leaving.size + arriving.size > 0;
    // Read everything before writing anything, so layout is computed once.
    const origin = host.getBoundingClientRect();
    const at = sprites ? layer.getBoundingClientRect() : origin;
    const slots = new Map<Sprite, DOMRect>();
    for (const s of arriving.values()) {
      if (s.glyph!.isConnected) {
        const r = s.glyph!.getBoundingClientRect();
        slots.set(s, new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height));
      }
    }

    // An edge may only reach past where layout puts it while the glyph there
    // is still on its way in (hidden, growing in what room the marks leave it).
    const isArriving = (i: number) => {
      const el = glyph(instance, i);
      return !!el && arriving.has(el);
    };
    const n = instance.state.length;
    const next = new Map<HTMLElement, { left: number; right: number; top: number }>();
    // Where each ellipsis' marks are drawn, ink to ink.
    const spans = new Map<HTMLElement, { left: number; right: number }>();
    for (const g of geo) {
      if (g.marks.length === 0) {
        const middle = (g.left + g.right) / 2;
        spans.set(g.ellipsis, { left: middle, right: middle });
        continue;
      }
      const r = regions.get(g.ellipsis);
      const showingBefore = g.before >= 0 && !isArriving(g.before);
      const showingAfter = g.after < n && !isArriving(g.after);
      const widths = g.marks.map((m) => m.right - m.left);
      const need = widths.reduce((sum, w) => sum + w, 0);
      const first = g.marks[0]!;
      const last = g.marks.at(-1)!;
      // Next to a glyph showing, they keep at least half the gap layout gives them.
      const hardLeft = showingBefore ? (g.left + first.left) / 2 : bounds.left;
      const hardRight = showingAfter ? (g.right + last.right) / 2 : bounds.right;
      const middle = (first.left + last.right) / 2;
      const inner = last.right - first.left - need;
      // Every gap, the outer ones too, takes the same share of the region as drawn.
      const gaps = g.right - g.left - need;
      const share = r && gaps > 0.01 ? Math.max(0, gaps + r.right - r.left) / gaps : 1;
      const wanted = need + inner * share;
      const room = 2 * Math.min(middle - hardLeft, hardRight - middle);
      // (One element drawing every dot can't spread.)
      const span = inner > 0.01 ? Math.max(need, Math.min(wanted, room)) : need;
      const left = middle - span / 2;
      next.set(g.ellipsis, { left: left - (first.left - g.left), right: left + span + (g.right - last.right), top: g.top });
      spans.set(g.ellipsis, { left, right: left + span });

      // Layout's gaps between marks, scaled to the drawn span.
      const scale = inner > 0.01 ? (span - need) / inner : 1;
      let x = left;
      g.marks.forEach((m, k) => {
        const shift = r ? x - m.left : 0;
        x += widths[k]! + ((g.marks[k + 1]?.left ?? m.right) - m.right) * scale;
        const still = Math.abs(shift) < 0.05;
        applied.set(m.el, still ? 0 : shift);
        m.el.style.transform = still ? '' : `translateX(${shift}px)`;
      });
    }
    drawn = next;
    if (sprites) drawSprites(geo, spans, slots, bounds, at.left - origin.left, at.top - origin.top, now);
  }

  // ---------------------------------------------------------------------------
  // Glyphs on their way in or out

  const progress = (s: Sprite, now: number) => (s.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - s.start) / s.ms)));

  function drop(s: Sprite) {
    s.el.remove();
    if (s.glyph) {
      if (arriving.get(s.glyph) === s) arriving.delete(s.glyph);
      s.glyph.style.color = '';
    } else if (leaving.get(s.i) === s) {
      leaving.delete(s.i);
    }
  }

  /** Land everything in flight: leaving glyphs are gone, arriving ones drawn. */
  function land() {
    for (const s of [...leaving.values(), ...arriving.values()]) drop(s);
  }

  function paint(s: Sprite, centre: number, top: number, layerX: number, layerY: number) {
    const style = s.el.style;
    style.left = `${centre - s.width / 2 - layerX}px`;
    style.top = `${top - layerY}px`;
    style.transform = s.scale < 1 ? `scale(${s.scale})` : '';
    style.opacity = String(s.alpha);
    if (effect === 'merge') style.color = `color-mix(in srgb, ${s.colors[1]} ${((1 - s.alpha) * 100).toFixed(1)}%, ${s.colors[0]})`;
    if (effect === 'blur') style.filter = `blur(${blur * 1.5 * (1 - s.alpha)}px)`;
  }

  /**
   * Size and opacity for a glyph given `fit`, the share of its width it has
   * room for, and `timed`, how far its effect has played. Merging, it shrinks
   * as it fades; fading, it only shrinks when it is squeezed.
   */
  function look(s: Sprite, fit: number, timed: number, leaves: boolean) {
    const scale = effect === 'merge' ? Math.min(fit, timed) : Math.min(1, fit);
    s.scale = leaves ? Math.min(s.scale, scale) : scale;
    s.alpha = effect === 'merge' ? s.scale : Math.min(leaves ? s.alpha : 1, timed, s.scale);
  }

  /**
   * Draw the glyphs leaving on one side of an ellipsis' marks, between `lo`
   * and `hi`. Each stays in its own place (moving with the text on its side)
   * and only has what is left of it there, shrinking to fit.
   */
  function squeeze(list: Sprite[], lo: number, hi: number, dir: 1 | -1, top: number, now: number, layerX: number, layerY: number) {
    const anchor = dir === 1 ? lo : hi;
    for (const s of list) {
      if (!s.anchored) {
        s.x = (s.home - anchor) * dir;
        s.anchored = true;
      }
      s.home = anchor + dir * s.x;
    }
    const sorted = list.toSorted((p, q) => p.home - q.home);
    for (const [k, s] of sorted.entries()) {
      const left = s.home - s.width / 2;
      const right = s.home + s.width / 2;
      let a = Math.max(lo, left);
      let b = Math.min(hi, right);
      // Neighbours whose ink overlaps (an `f` reaching over the next letter) split it down the middle.
      const before = sorted[k - 1];
      const after = sorted[k + 1];
      if (before && before.home + before.width / 2 > left) a = Math.max(a, (before.home + before.width / 2 + left) / 2);
      if (after && after.home - after.width / 2 < right) b = Math.min(b, (after.home - after.width / 2 + right) / 2);
      look(s, Math.max(0, b - a) / s.width, s.from * (1 - ease(progress(s, now))), true);
      if (s.width * s.scale < SPECK || s.alpha <= 0.01) {
        drop(s);
        continue;
      }
      const half = (s.scale * s.width) / 2;
      paint(s, Math.min(Math.max(s.home, a + half), b - half), top + s.dy, layerX, layerY);
    }
  }

  function drawSprites(
    geo: Geometry[],
    spans: Map<HTMLElement, { left: number; right: number }>,
    slots: Map<Sprite, DOMRect>,
    bounds: { left: number; right: number },
    layerX: number,
    layerY: number,
    now: number,
  ) {
    const n = instance.state.length;
    const groups = new Map<HTMLElement, Sprite[]>();
    for (const s of leaving.values()) groups.set(s.ellipsis!, [...(groups.get(s.ellipsis!) ?? []), s]);
    for (const g of geo) {
      const list = groups.get(g.ellipsis);
      if (!list) continue;
      groups.delete(g.ellipsis);
      const span = spans.get(g.ellipsis)!;
      const lo = g.before >= 0 ? g.left : bounds.left;
      const hi = g.after < n ? g.right : bounds.right;
      const on = (side: Sprite['side']) => list.filter((s) => s.side === side);
      squeeze(on('left'), lo, span.left, 1, g.top, now, layerX, layerY);
      squeeze(on('right'), span.right, hi, -1, g.top, now, layerX, layerY);
    }
    // Their ellipsis went away with the truncation.
    for (const list of groups.values()) list.forEach(drop);

    for (const s of arriving.values()) {
      const box = slots.get(s);
      if (!box) {
        drop(s);
        continue;
      }
      // Its own place in the line, less whatever the marks still cover.
      let a = box.left + s.inkDx;
      let b = a + s.width;
      const middle = (a + b) / 2;
      for (const g of geo) {
        if (g.bottom <= box.top || g.top >= box.bottom) continue;
        const span = spans.get(g.ellipsis)!;
        if (span.right <= a || span.left >= b) continue;
        if (span.left + span.right >= a + b) b = Math.min(b, span.left);
        else a = Math.max(a, span.right);
      }
      const p = progress(s, now);
      look(s, Math.max(0, b - a) / s.width, s.from + (1 - s.from) * ease(p), false);
      if (p >= 1 && s.scale >= 0.999) {
        drop(s);
        continue;
      }
      const half = (s.scale * s.width) / 2;
      paint(s, Math.min(Math.max(middle, a + half), b - half), box.top, layerX, layerY);
    }
  }

  /** An element drawing a glyph over its ink: the wrapper shrinks around the ink, the text inside sits where it did. */
  function spriteOf(text: string, box: DOMRect, ink: DOMRect, style: CSSStyleDeclaration): HTMLSpanElement {
    const el = document.createElement('span');
    el.style.cssText = `position:absolute;margin:0;width:${ink.width}px;height:${box.height}px;color:${style.color}`;
    const inner = document.createElement('span');
    // `font` resets line-height, so it goes first.
    inner.style.cssText =
      `display:block;margin-left:${box.left - ink.left}px;white-space:pre;` +
      `font:${style.font};line-height:${box.height}px;letter-spacing:${style.letterSpacing}`;
    inner.textContent = text;
    el.append(inner);
    layer.append(el);
    return el;
  }

  /** The middle of the ellipsis on the same line as `box`: what glyphs merge towards vertically. */
  function lineMark(box: DOMRect): DOMRect | undefined {
    for (let j = 0; j < instance.state.hidden.length; j++) {
      const r = markInks(instance, j)[0] ?? ellipsisRect(instance, j);
      if (r && r.bottom > box.top && r.top < box.bottom) return r;
    }
    return undefined;
  }

  /** Which side of an ellipsis' marks a glyph that just left it is on. */
  function sideOf(i: number, part: Part, previous: readonly Part[]): Sprite['side'] {
    for (const p of previous) {
      if (p.start >= part.end || p.end <= part.start) continue;
      if (i < p.start) return 'left';
      if (i >= p.end) return 'right';
    }
    return i < (part.start + part.end) / 2 ? 'left' : 'right';
  }

  function enter(i: number, ms: number) {
    const el = glyph(instance, i);
    const ink = glyphInk(instance, i);
    // Coming back while still on its way out: it turns around where it is.
    const back = leaving.get(i);
    const from = back ? back.alpha : 0;
    if (back) drop(back);
    const text = instance.graphemes[i] ?? '';
    if (!el || !ink || ink.width <= 0 || isWhitespace(text) || arriving.has(el)) return;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const mark = lineMark(box) ?? ink;
    const s: Sprite = {
      i,
      el: spriteOf(text, box, ink, style),
      ellipsis: null,
      side: 'left',
      glyph: el,
      width: ink.width,
      inkDx: ink.left - box.left,
      home: 0,
      x: 0,
      anchored: true,
      dy: 0,
      from,
      scale: effect === 'merge' ? from : 1,
      alpha: from,
      start: performance.now(),
      ms,
      colors: [style.color, getComputedStyle(instance.ellipsisElement).color],
    };
    s.el.style.transformOrigin = `50% ${mark.top + mark.height / 2 - box.top}px`;
    el.style.color = 'transparent';
    arriving.set(el, s);
  }

  function leave(i: number, before: Before, change: ElideChange, ms: number) {
    // Leaving while still on its way in: it turns around where it is.
    const back = [...arriving.values()].find((s) => s.i === i);
    const from = back ? back.alpha : 1;
    if (back) drop(back);
    const j = change.state.hidden.findIndex((p) => i >= p.start && i < p.end);
    const part = change.state.hidden[j];
    const ellipsis = instance.ellipses[j];
    const text = instance.graphemes[i] ?? '';
    const { box, ink } = before;
    if (!part || !ellipsis || ink.width <= 0 || isWhitespace(text) || from <= 0) return;
    const mark = markInks(instance, j)[0] ?? ellipsisRect(instance, j);
    // Off the ellipsis' line (the text reflowed), there is nothing to merge into.
    if (!mark || mark.bottom <= box.top || mark.top >= box.bottom) return;
    // The glyph is gone from the DOM; its join carries the same text style.
    const style = getComputedStyle(ellipsis.parentElement ?? host);
    const origin = host.getBoundingClientRect();
    const s: Sprite = {
      i,
      el: spriteOf(text, box, ink, style),
      ellipsis,
      side: sideOf(i, part, change.previous?.hidden ?? []),
      glyph: null,
      width: ink.width,
      inkDx: 0,
      home: ink.left + ink.width / 2 - origin.left,
      x: 0,
      anchored: false,
      dy: box.top - mark.top,
      from,
      scale: effect === 'merge' ? from : 1,
      alpha: from,
      start: performance.now(),
      ms,
      colors: [style.color, getComputedStyle(instance.ellipsisElement).color],
    };
    s.el.style.transformOrigin = `50% ${mark.top + mark.height / 2 - box.top}px`;
    leaving.get(i)?.el.remove();
    leaving.set(i, s);
  }

  /**
   * The cut just changed. Every glyph on its way out moves as much as the
   * text on its side just did, and keeps its distance from whatever is next
   * to the ellipsis now.
   */
  function rebase(change: ElideChange) {
    for (const s of leaving.values()) {
      const j = change.state.hidden.findIndex((p) => s.i >= p.start && s.i < p.end);
      const part = change.state.hidden[j];
      const ellipsis = instance.ellipses[j];
      if (!part || !ellipsis) {
        drop(s);
        continue;
      }
      s.ellipsis = ellipsis;
      const next = s.side === 'left' ? part.start - 1 : part.end;
      const was = change.glyphsBefore.get(next)?.ink;
      const is = glyphInk(instance, next);
      if (was && is) s.home += is.left - was.left;
      s.anchored = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Frames

  function tick(now: number) {
    frame = 0;
    const dt = Math.min(0.05, lastTick !== 0 ? (now - lastTick) / 1000 : 1 / 60);
    lastTick = now;
    for (const [el, r] of regions) {
      if (!el.isConnected) {
        regions.delete(el);
        continue;
      }
      [r.left, r.vLeft] = settle(r.left, r.vLeft, omega, dt);
      [r.right, r.vRight] = settle(r.right, r.vRight, omega, dt);
      const done = (x: number, v: number) => Math.abs(x) < 0.05 && Math.abs(v) < 1;
      if (done(r.left, r.vLeft) && done(r.right, r.vRight)) regions.delete(el);
    }
    draw(now);
    loop();
  }

  function loop() {
    if (regions.size + leaving.size + arriving.size > 0) frame ||= requestAnimationFrame(tick);
    else if (frame === 0) lastTick = 0;
  }

  /**
   * Layout just moved an ellipsis' neighbours (a glyph came or went). Keep
   * its region where it was on screen and let the edges glide over,
   * carrying their current velocity.
   */
  function glideMarks() {
    for (const g of geometry()) {
      const before = drawn.get(g.ellipsis);
      // An ellipsis that changed lines just goes there; gliding across lines reads as noise.
      if (!before || Math.abs(before.top - g.top) > 2) continue;
      const left = before.left - g.left;
      const right = before.right - g.right;
      // Only the spacing glides: a region that kept its width has nothing to do.
      if (Math.abs(right - left) < 0.25) continue;
      const r = regions.get(g.ellipsis) ?? { left: 0, right: 0, vLeft: 0, vRight: 0 };
      r.left = left;
      r.right = right;
      regions.set(g.ellipsis, r);
    }
  }

  // ---------------------------------------------------------------------------
  // New ellipses

  function place() {
    const origin = layer.getBoundingClientRect();
    // Read everything, then write, so layout is computed once.
    const boxes = [...fades].map((f) => (f.follow.isConnected ? f.follow.getBoundingClientRect() : null));
    let i = 0;
    for (const f of fades) {
      const box = boxes[i++];
      if (!box) continue; // e.g. the ellipsis went away with the truncation; stay put
      f.el.style.left = `${box.left - origin.left}px`;
      f.el.style.top = `${box.top - origin.top}px`;
    }
  }

  /**
   * Fade a new ellipsis in through a copy: animating the element itself is
   * fragile, since fitting may briefly move it, which restarts animations.
   */
  function appear(j: number) {
    const real = instance.ellipses[j];
    const rect = ellipsisRect(instance, j);
    if (!real || !rect) return;
    const style = getComputedStyle(real);
    const el = document.createElement('span');
    el.style.cssText = `position:absolute;margin:0;width:${rect.width}px;height:${rect.height}px;color:${style.color}`;
    const inner = document.createElement('span');
    inner.style.cssText = `display:block;white-space:pre;font:${style.font};line-height:${rect.height}px;letter-spacing:${style.letterSpacing}`;
    inner.append(...Array.from(real.childNodes, (n) => n.cloneNode(true)));
    el.append(inner);
    layer.append(el);
    real.style.visibility = 'hidden';
    const f: Fade = { el, follow: real, anim: el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing }) };
    fades.add(f);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      f.anim.cancel();
      el.remove();
      fades.delete(f);
      real.style.visibility = '';
    };
    f.anim.addEventListener('finish', end);
    f.anim.addEventListener('cancel', end);
  }

  // ---------------------------------------------------------------------------
  // Pacing

  /**
   * How long leaving glyphs get, by room. Removing glyphs frees their width, minus
   * whatever the text was overflowing by; what is left over is the room the
   * animation has. Little room means the text is squeezed (a fast drag, a
   * jump in position): be quick, down to nothing.
   */
  function leaveTime(change: ElideChange): number {
    if (change.hidden.length === 0) return duration * 0.85;
    let removed = 0;
    for (const i of change.hidden) removed += change.hiddenGlyphs.get(i)?.box.width ?? 0;
    if (removed === 0) return duration * 0.85;
    const leeway = Math.min(1, Math.max(0, change.state.slack / removed));
    return duration * 0.85 * leeway;
  }

  const offChange = onChange(instance, (change: ElideChange) => {
    if (change.reset || !change.previous || reduced()) {
      land();
      return;
    }

    // Leaving, room is one limit; time is the other. When changes come
    // faster than their animations can play (a slider dragged, a fast
    // resize), each gets a few times the gap since the last one, and soon
    // nothing at all. Arriving glyphs grow in their own place, so they
    // always take their time.
    const now = performance.now();
    const ms = Math.min(leaveTime(change), (now - lastChange) * 3);
    lastChange = now;
    const instant = ms < INSTANT;
    const goes = change.hidden.length > 0 && effect !== 'none' && !instant;
    const comes = change.shown.length > 0 && effect !== 'none';
    // No time for this change means the text is moving fast: whatever is
    // still leaving from earlier changes goes now too, rather than piling up.
    if (change.hidden.length > 0 && instant) {
      for (const s of leaving.values()) drop(s);
      for (const f of Array.from(fades)) f.anim.finish();
    }

    // Arriving glyphs first: the spacing may only glide over glyphs still on their way in.
    if (comes) for (const i of change.shown) enter(i, duration);
    if (goes) {
      for (const i of change.hidden) {
        const before = change.hiddenGlyphs.get(i);
        if (before) leave(i, before, change, ms);
      }
    }
    // Whatever doesn't get to animate is where layout says at once.
    const hidden = new Set(change.hidden);
    for (const s of arriving.values()) if (hidden.has(s.i)) drop(s);
    rebase(change);

    if (glide) glideMarks();
    if (effect !== 'none') for (let j = change.previous.hidden.length; j < change.state.hidden.length; j++) appear(j);
    draw(now);
    if (fades.size > 0) place();
    loop();
  });

  // After every pass, with layout final for this frame: redraw the ellipses
  // and the glyphs around them. A region's glide offsets are relative to
  // layout, so the gentle drift of resizing is followed directly; only jumps
  // glide.
  // (Doing this in a frame callback would see the old text reflowed at the
  // new width, before truncation catches up, often a line lower.)
  const offRender = instance.onRender(() => {
    draw();
    if (fades.size > 0) place();
  });
  draw();

  return () => {
    offChange();
    offRender();
    land();
    for (const f of Array.from(fades)) f.anim.cancel();
    regions.clear();
    instance.state.hidden.forEach((_, j) => {
      for (const el of markElements(instance, j)) {
        el.style.transform = '';
        applied.delete(el);
      }
    });
    cancelAnimationFrame(frame);
    layer.remove();
  };
}
