import type { Elide, ElideChange, Part } from './elide.js';

export type Effect = 'fade' | 'blur' | 'merge';

export interface TransitionOptions {
  /**
   * - 'fade': glyphs fade in and out in place
   * - 'blur': glyphs fade through a blur in place
   * - 'merge' (default): a glyph that leaves shrinks into the nearest mark of
   *   the ellipsis and turns into it; one that arrives grows out of it
   */
  effect?: Effect;
  /** Milliseconds. Default 460. */
  duration?: number;
  /** For glyphs leaving; arriving glyphs play the same curve backwards. */
  easing?: string;
  /** Blur radius in px. Default 4. */
  blur?: number;
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
 * Animate glyphs as truncation reveals or hides them. Needs an instance
 * created with `glyphs: true`. Returns a function that stops the transitions.
 *
 * Ghosts live in an overlay next to the text, never inside it: anything
 * positioned inside the line would disturb its measurement, and the line's
 * elements move around while fitting. A frame loop keeps each ghost on its
 * glyph (or on its ellipsis) while the text reflows.
 */
export function transitions(instance: Elide, options: TransitionOptions = {}): () => void {
  const {
    effect = 'merge',
    duration = 460,
    easing = 'cubic-bezier(.45,0,.2,1)',
    blur = 4,
    respectReducedMotion = true,
  } = options;
  const ghosts = new Set<Ghost>();
  const entering = new Map<HTMLElement, Ghost>();
  let frame = 0;

  // Absolutely positioned without offsets, the layer sits at the start of the
  // host's content, whatever the host's own positioning.
  const layer = document.createElement('span');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('data-fp-ghosts', '');
  layer.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
  instance.element.prepend(layer);

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

  function loop() {
    frame = 0;
    if (!ghosts.size) return;
    place();
    frame = requestAnimationFrame(loop);
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
    if (!frame) frame = requestAnimationFrame(loop);
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

  /** The mark a newly shown glyph grows out of. */
  function sourceMark(i: number, change: ElideChange): DOMRect | undefined {
    const was = change.previous?.hidden.findIndex((p) => i >= p.start && i < p.end) ?? -1;
    const prev = change.previous?.hidden[was];
    if (!prev) return undefined;
    // The part it came from usually still exists, a little smaller.
    const now = change.state.hidden
      .map((p, j) => ({ p, j }))
      .filter(({ p }) => p.start < prev.end && p.end > prev.start)
      .sort((a, b) => Math.abs((a.p.start + a.p.end) / 2 - i) - Math.abs((b.p.start + b.p.end) / 2 - i))[0];
    if (now) {
      const marks = instance.marks(now.j);
      return i < now.p.start ? marks[0] : marks[marks.length - 1];
    }
    return markOf(i, prev, change.marksBefore[was] ?? []);
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

  function leave(i: number, before: { box: DOMRect; ink: DOMRect }, change: ElideChange) {
    const j = change.state.hidden.findIndex((p) => i >= p.start && i < p.end);
    const part = change.state.hidden[j];
    const follow = instance.ellipses[j];
    const anchor = instance.ellipsisRect(j);
    if (!part || !follow || !anchor) return;
    const { box, ink } = before;
    // The glyph is gone from the DOM; its join carries the same text style.
    const style = getComputedStyle(follow.parentElement ?? instance.element);
    const ghost = ghostOf(instance.graphemes[i] ?? '', box, style, style.color);
    let anims: Animation[];
    if (effect === 'merge') {
      const mark = markOf(i, part, instance.marks(j));
      if (!mark) {
        ghost.el.remove();
        return;
      }
      const markColor = getComputedStyle(instance.ellipsisElement).color;
      anims = morph(ghost, box, ink, mark, [style.color, markColor], duration * 0.85, false);
    } else {
      anims = [ghost.el.animate(fadeFrames(), { duration: duration * 0.8, easing, direction: 'reverse', fill: 'both' })];
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

  const off = instance.onChange((change: ElideChange) => {
    // Glyphs hidden mid-entrance stop entering.
    for (const i of change.hidden) {
      const el = instance.glyph(i);
      if (el) entering.get(el)?.anims.forEach((a) => a.cancel());
    }
    if (change.reset || !change.previous) return;
    if (respectReducedMotion && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    for (const i of change.shown) enter(i, change);
    for (const i of change.hidden) {
      const before = change.hiddenGlyphs.get(i);
      if (before) leave(i, before, change);
    }
    for (let j = change.previous.hidden.length; j < change.state.hidden.length; j++) appear(j);
    if (ghosts.size) place();
  });

  return () => {
    off();
    for (const g of [...ghosts]) g.anims.forEach((a) => a.cancel());
    cancelAnimationFrame(frame);
    layer.remove();
  };
}
