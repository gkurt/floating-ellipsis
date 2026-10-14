import type { Elide, ElideChange } from './elide.js';

export type Effect = 'fade' | 'blur' | 'merge';

export interface TransitionOptions {
  /**
   * - 'fade': glyphs fade in and out in place
   * - 'blur': glyphs fade through a blur in place
   * - 'merge' (default): glyphs fly out of and into the ellipsis
   */
  effect?: Effect;
  /** Milliseconds. Default 420. */
  duration?: number;
  easing?: string;
  /** Blur radius in px. Default 4. */
  blur?: number;
  /** Skip animations when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
}

type Frame = Keyframe & { transform?: string; opacity?: number; filter?: string };

interface Ghost {
  el: HTMLSpanElement;
  anim: Animation;
  /** Element the ghost rides on: the glyph it reveals, or the ellipsis it merges into. */
  follow: HTMLElement;
  /** Offset from the followed element's top-left corner. */
  dx: number;
  dy: number;
  /** For entering glyphs: the real glyph, hidden until the ghost lands. */
  glyph?: HTMLElement;
}

/**
 * Animate glyphs as truncation reveals or hides them. Needs an instance
 * created with `glyphs: true`. Returns a function that stops the transitions.
 *
 * Ghosts live in an overlay next to the text, never inside it: anything
 * absolutely positioned inside the line would disturb its measurement. A frame
 * loop keeps each ghost on its glyph (or on the ellipsis) while text reflows.
 */
export function transitions(instance: Elide, options: TransitionOptions = {}): () => void {
  const {
    effect = 'merge',
    duration = 420,
    easing = 'cubic-bezier(.2,.75,.25,1)',
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

  const hiddenFrame = (dx: number, dy: number): Frame => {
    if (effect === 'merge') return { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0, filter: `blur(${blur}px)` };
    if (effect === 'blur') return { transform: 'none', opacity: 0, filter: `blur(${blur * 1.5}px)` };
    return { transform: 'none', opacity: 0, filter: 'blur(0px)' };
  };
  const shownFrame: Frame = { transform: 'none', opacity: 1, filter: 'blur(0px)' };
  const center = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const;

  function place() {
    const origin = layer.getBoundingClientRect();
    // Read everything, then write, so layout is computed once.
    const boxes = [...ghosts].map((g) => (g.follow.isConnected ? g.follow.getBoundingClientRect() : null));
    let i = 0;
    for (const g of ghosts) {
      const box = boxes[i++];
      if (!box) continue; // e.g. the ellipsis left with the truncation; stay put
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

  function spawn(text: string, rect: DOMRect, style: CSSStyleDeclaration, ghost: Omit<Ghost, 'el' | 'anim'>, keyframes: Frame[], ms: number) {
    const el = document.createElement('span');
    el.textContent = text;
    // `font` resets line-height, so it goes first.
    el.style.cssText =
      `position:absolute;white-space:pre;margin:0;font:${style.font};line-height:${rect.height}px;` +
      `letter-spacing:${style.letterSpacing};color:${style.color};width:${rect.width}px;height:${rect.height}px`;
    layer.append(el);
    const anim = el.animate(keyframes, { duration: ms, easing });
    const g: Ghost = { ...ghost, el, anim };
    ghosts.add(g);
    const done = () => {
      el.remove();
      ghosts.delete(g);
      if (g.glyph) {
        g.glyph.style.color = '';
        if (entering.get(g.glyph) === g) entering.delete(g.glyph);
      }
    };
    anim.onfinish = done;
    anim.oncancel = done;
    if (!frame) frame = requestAnimationFrame(loop);
    return g;
  }

  function enter(index: number, anchor: DOMRect | null) {
    const el = instance.glyph(index);
    if (!el || !el.isConnected) return;
    entering.get(el)?.anim.cancel();
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const [x, y] = center(rect);
    const [ax, ay] = anchor ? center(anchor) : [x, y];
    const g = spawn(
      instance.graphemes[index] ?? '',
      rect,
      style,
      { follow: el, dx: 0, dy: 0, glyph: el },
      [hiddenFrame(ax - x, ay - y), shownFrame],
      duration,
    );
    el.style.color = 'transparent';
    entering.set(el, g);
  }

  function leave(index: number, from: DOMRect, anchor: DOMRect, style: CSSStyleDeclaration) {
    const [x, y] = center(from);
    const [ax, ay] = center(anchor);
    spawn(
      instance.graphemes[index] ?? '',
      from,
      style,
      { follow: instance.ellipsisElement, dx: from.left - anchor.left, dy: from.top - anchor.top },
      [shownFrame, hiddenFrame(ax - x, ay - y)],
      duration * 0.8,
    );
  }

  /**
   * Fade the ellipsis in through a ghost: animating the element itself is
   * fragile, since fitting may briefly take it out of the DOM, which
   * restarts its animations.
   */
  function appear(rect: DOMRect) {
    const real = instance.ellipsisElement;
    const g = spawn('', rect, getComputedStyle(real), { follow: real, dx: 0, dy: 0 }, [{ opacity: 0 }, { opacity: 1 }], duration);
    g.el.replaceChildren(...Array.from(real.childNodes, (n) => n.cloneNode(true)));
    real.style.visibility = 'hidden';
    g.anim.addEventListener('finish', () => (real.style.visibility = ''));
    g.anim.addEventListener('cancel', () => (real.style.visibility = ''));
  }

  const off = instance.onChange((change: ElideChange) => {
    // Glyphs hidden mid-entrance stop entering.
    for (const i of change.hidden) {
      const el = instance.glyph(i);
      if (el) entering.get(el)?.anim.cancel();
    }
    if (change.reset || !change.previous) return;
    if (respectReducedMotion && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const anchor = change.ellipsis.to ?? change.ellipsis.from;
    for (const i of change.shown) enter(i, anchor);

    const to = change.ellipsis.to;
    if (to && change.hidden.length) {
      const style = getComputedStyle(instance.ellipsisElement.parentElement ?? instance.element);
      for (const i of change.hidden) {
        const from = change.hiddenRects.get(i);
        if (from) leave(i, from, to, style);
      }
    }
    if (to && !change.previous.truncated) appear(to);
    if (ghosts.size) place();
  });

  return () => {
    off();
    for (const g of [...ghosts]) g.anim.cancel();
    cancelAnimationFrame(frame);
    layer.remove();
  };
}
