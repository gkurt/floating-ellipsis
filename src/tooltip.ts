import type { Elide } from './elide.ts';

/**
 * What a tip shows, and where:
 * - 'grow': the full text over the line, growing out of it. Every glyph
 *   starts where it is on screen, and hidden ones come out of their ellipsis.
 * - 'expand': the same full text over the line, at once.
 * - 'peek': only what one ellipsis hides, next to that ellipsis. Hovering the
 *   ellipsis (its whole area, gaps included) shows it.
 */
export type Reveal = 'grow' | 'expand' | 'peek';

export interface TooltipOptions {
  /** What the tip shows, and where. Default 'grow'. */
  reveal?: Reveal;
  /**
   * Milliseconds the pointer rests on a trigger before its tip shows.
   * Default 500. Focus shows a tip at once.
   */
  delay?: number;
  /**
   * While a tip is showing, and for this many milliseconds after it closes,
   * the next one shows without the delay, so moving along a list only makes
   * you wait for the first. Default 300.
   */
  grace?: number;
  /**
   * Characters a full-text tip may wrap after, as well as at spaces: `'/\\'`
   * for paths. Pressing twice selects the run of text between them. Default ''.
   */
  breaks?: string;
  /**
   * 'grow' and 'expand': the widest a full-text tip gets, as a fraction of
   * the window's width, unless the line it covers is wider. Longer text wraps.
   * Default 0.5.
   */
  maxWidth?: number;
  /**
   * 'grow' and 'expand': a full-text tip wraps at the window's edge, staying
   * where its text starts, while it's at least this many times as wide as
   * it's tall. Any narrower, it widens to the left, only as far as it must.
   * Default 2.
   */
  aspect?: number;
  /** How close the tip comes to the edges of the window, in px. Default 8. */
  edge?: number;
  /** 'peek': the distance between the ellipsis' ink and the tip, in px. Default 8. */
  offset?: number;
  /** 'peek': how far around an ellipsis' area still counts as on it, in px. Default 4. */
  slop?: number;
  /**
   * 'grow' and 'expand': a press on the tip starts selecting its text (two
   * select a run between breaks, three all of it), and the tip stays open
   * while it's hovered or holds a selection. Default true.
   */
  selectable?: boolean;
  /** 'grow': milliseconds. Default 460. */
  duration?: number;
  /** 'grow': the easing of every glyph and the background. */
  easing?: string;
  /** Skip the 'grow' animation when the user prefers reduced motion. Default true. */
  respectReducedMotion?: boolean;
  /**
   * The element the tip goes in. Default `document.body`. Put it inside a
   * modal `<dialog>` to show tips for text in it, since the dialog is drawn
   * above the rest of the page. A container that is the containing block of
   * fixed elements (it has a transform, filter or `contain`) works too, as
   * long as it isn't scaled or rotated.
   */
  container?: Element;
  /** Called when a tip opens, after it's laid out. */
  onShow?: (target: TooltipTarget) => void;
  /** Called when a tip closes. */
  onHide?: (target: TooltipTarget) => void;
}

/** A tip's subject. */
export interface TooltipTarget {
  instance: Elide;
  /** The element that shows the tip when hovered or focused. */
  trigger: Element;
  /** 'peek': the ellipsis whose hidden text the tip shows. Otherwise null. */
  ellipsis: number | null;
}

type Settings = Required<Omit<TooltipOptions, 'container' | 'onShow' | 'onHide'>> & Pick<TooltipOptions, 'container' | 'onShow' | 'onHide'>;

const DEFAULTS: Settings = {
  reveal: 'grow',
  delay: 500,
  grace: 300,
  breaks: '',
  maxWidth: 0.5,
  aspect: 2,
  edge: 8,
  offset: 8,
  slop: 4,
  selectable: true,
  duration: 460,
  easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  respectReducedMotion: true,
};

/** Where every grapheme of the tip's text is before it grows: its box on screen. */
interface Origin {
  from: DOMRect[];
  /** The ellipsis hiding each grapheme, or -1. */
  part: number[];
  dots: { el: HTMLElement; rect: DOMRect }[];
}

const OPEN = 'data-fp-tip-open';

/**
 * A headless tooltip for truncated text: one tip element, shared by every
 * instance attached to it, that shows on hover and focus and lines its text
 * up with the original. It brings the behaviour (delays, placement, the
 * 'grow' animation, selecting text in the tip, dismissing) and no looks.
 *
 * Style it through attributes: the tip is `[data-fp-tip]` (its value is the
 * reveal), its background `[data-fp-tip-bg]`, a layer of its own so it can
 * grow without reflowing the text, and the ellipsis marks it fades out keep
 * `[data-fp-mark]`. A 'peek' tip has `data-side` ('top' or 'bottom') and
 * `--fp-tip-anchor`, the anchor's x from its left edge, for an arrow. A held
 * tip has `data-held`. The trigger whose tip is showing, and in 'peek' the
 * ellipsis, get `data-fp-tip-open`.
 */
export class Tooltip {
  /** The tip, in `container`. It's `position: fixed`. */
  readonly element: HTMLElement;
  private settings: Settings;
  private triggers = new WeakMap<Element, Elide>();
  private triggerOf = new WeakMap<Elide, Element>();
  private current: TooltipTarget | null = null;
  private waiting: TooltipTarget | null = null;
  private timer = 0;
  private closedAt = -Infinity;
  private unrender: (() => void) | null = null;
  /** The tip's text, one span per grapheme. */
  private spans: HTMLSpanElement[] = [];
  /** Puts the text back in the flow once it has grown. */
  private landing: (() => void) | null = null;
  private scrolled = [0, 0];
  /** A selection carried over to the tip, and the one it replaced. */
  private carried: { text: string; original: Range } | null = null;
  private holding = false;
  private dragging = false;
  private anchor = 0;
  // Pointer events don't count clicks (their `detail` is 0), so presses are
  // counted here: one soon enough after the last, close enough to it, adds one.
  private presses = { count: 0, time: 0, x: 0, y: 0 };
  /** Where the tip's `left: 0; top: 0` is in the viewport (not at 0, 0 in a container that is its containing block). */
  private frame = { x: 0, y: 0 };
  private listening = new AbortController();

  constructor(options: TooltipOptions = {}) {
    this.settings = { ...DEFAULTS, ...options };
    const tip = document.createElement('div');
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    // Layout only: everything it looks like is the page's to style.
    Object.assign(tip.style, {
      position: 'fixed',
      boxSizing: 'border-box',
      margin: '0',
      isolation: 'isolate',
      pointerEvents: 'none',
    });
    (this.settings.container ?? document.body).append(tip);
    this.element = tip;

    const on = { signal: this.listening.signal };
    const passive = { ...on, passive: true };
    // Capture, so a press on the tip is its own before the page under it sees it.
    document.addEventListener('pointerdown', this.onPress, { ...on, capture: true });
    document.addEventListener('pointermove', this.onHover, passive);
    document.addEventListener('pointerout', (e) => !e.relatedTarget && this.close(), passive);
    document.addEventListener('focusin', this.onFocus, on);
    document.addEventListener('focusout', this.onBlur, on);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.close(true), on);
    document.addEventListener('scroll', this.onScroll, { ...passive, capture: true });
    window.addEventListener('resize', () => this.close(true), passive);
    tip.addEventListener('pointermove', this.onDrag, on);
    tip.addEventListener('pointerup', this.onRelease, on);
    tip.addEventListener('pointercancel', this.onRelease, on);
    tip.addEventListener('pointerleave', (e) => this.leave(e.clientX, e.clientY), on);
  }

  get options(): Readonly<TooltipOptions> {
    return this.settings;
  }

  /** What the tip is showing, or null. */
  get target(): TooltipTarget | null {
    return this.current;
  }

  /** Whether the tip is held: pressed onto and hovered, or holding a selection. It won't close or change by itself then. */
  get held(): boolean {
    return this.holding;
  }

  update(options: TooltipOptions): void {
    const { reveal, container } = this.settings;
    if ((options.reveal !== undefined && options.reveal !== reveal) || (options.container !== undefined && options.container !== container))
      this.close(true);
    this.settings = { ...this.settings, ...options };
    if (this.settings.container !== container) (this.settings.container ?? document.body).append(this.element);
  }

  /**
   * Show tips for `instance` when `trigger` (its element by default, or say
   * the row it's in) is hovered or focused. Returns a function that detaches it.
   */
  attach(instance: Elide, trigger: Element = instance.element): () => void {
    this.triggers.set(trigger, instance);
    this.triggerOf.set(instance, trigger);
    return () => {
      if (this.current?.instance === instance) this.close(true);
      if (this.triggers.get(trigger) === instance) this.triggers.delete(trigger);
      if (this.triggerOf.get(instance) === trigger) this.triggerOf.delete(instance);
    };
  }

  /** Show `instance`'s tip now ('peek': for its ellipsis `ellipsis`). False when there's nothing to show. */
  show(instance: Elide, ellipsis = 0): boolean {
    const trigger = this.triggerOf.get(instance) ?? instance.element;
    this.open({ instance, trigger, ellipsis: this.settings.reveal === 'peek' ? ellipsis : null });
    return this.current?.instance === instance;
  }

  /** Close the tip, held or not. */
  hide(): void {
    this.close(true);
  }

  destroy(): void {
    this.close(true);
    this.listening.abort();
    this.element.remove();
  }

  // -------------------------------------------------------------------------
  // Showing and hiding

  private same(a: TooltipTarget | null, b: TooltipTarget | null) {
    return !!a && !!b && a.instance === b.instance && a.ellipsis === b.ellipsis;
  }

  /** The attached trigger `node` is in, and its instance. */
  private triggerAt(node: EventTarget | null): { trigger: Element; instance: Elide } | null {
    for (let el = node instanceof Element ? node : null; el; el = el.parentElement) {
      const instance = this.triggers.get(el);
      if (instance) return instance.truncated ? { trigger: el, instance } : null;
    }
    return null;
  }

  /** Show `target` once the delay allows. */
  private request(target: TooltipTarget) {
    this.cancel();
    const warm = this.current !== null || performance.now() - this.closedAt < this.settings.grace;
    if (warm || this.settings.delay <= 0) return this.open(target);
    this.waiting = target;
    this.timer = window.setTimeout(() => this.open(target), this.settings.delay);
  }

  /** Forget a tip that was waiting to show. */
  private cancel() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.waiting = null;
  }

  private open(target: TooltipTarget) {
    this.cancel();
    if (this.holding) return;
    this.close(false, true);
    if (!target.instance.truncated) return;
    const { reveal, respectReducedMotion } = this.settings;
    const still = respectReducedMotion && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shown = reveal === 'peek' ? this.peek(target) : this.full(target, reveal === 'grow' && !still);
    if (!shown) return this.close(true);
    this.current = target;
    this.scrolled = [scrollX, scrollY];
    target.trigger.setAttribute(OPEN, '');
    if (target.ellipsis !== null) target.instance.ellipses[target.ellipsis]?.setAttribute(OPEN, '');
    if (reveal !== 'peek') this.carrySelection(target.instance);
    // Laid out again, it no longer lines up with the text.
    this.unrender = target.instance.onRender(() => this.close());
    this.settings.onShow?.(target);
  }

  /**
   * Close the tip, unless it's held and not `force`d. `switching` to another
   * tip: it doesn't count as closing for the grace period.
   */
  private close(force = false, switching = false) {
    if (this.holding && !force) return;
    if (!switching) this.cancel();
    this.release();
    const target = this.current;
    if (!target) return;
    this.restoreSelection();
    this.element.hidden = true;
    this.landing = null;
    for (const a of this.element.getAnimations({ subtree: true })) a.cancel();
    target.trigger.removeAttribute(OPEN);
    if (target.ellipsis !== null) target.instance.ellipses[target.ellipsis]?.removeAttribute(OPEN);
    this.unrender?.();
    this.unrender = null;
    this.current = null;
    this.closedAt = performance.now();
    this.settings.onHide?.(target);
  }

  private onHover = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || this.holding) return;
    const found = this.triggerAt(e.target);
    if (!found) return this.close();
    let ellipsis: number | null = null;
    if (this.settings.reveal === 'peek') {
      ellipsis = found.instance.ellipsisAt(e.clientX, e.clientY, this.settings.slop);
      if (ellipsis < 0) return this.close();
    }
    const target = { ...found, ellipsis };
    if (this.same(target, this.current)) return this.cancel();
    if (this.same(target, this.waiting)) return;
    this.close(false, true);
    this.request(target);
  };

  private onFocus = (e: FocusEvent) => {
    if (this.holding) return;
    const found = this.triggerAt(e.target);
    if (!found) return;
    const target = { ...found, ellipsis: this.settings.reveal === 'peek' ? 0 : null };
    if (!this.same(target, this.current)) this.open(target);
  };

  private onBlur = (e: FocusEvent) => {
    const trigger = this.current?.trigger;
    if (!trigger || !(e.target instanceof Node) || !trigger.contains(e.target)) return;
    if (e.relatedTarget instanceof Node && trigger.contains(e.relatedTarget)) return;
    this.close();
  };

  /** The tip is fixed: a scroll takes the text out from under it. */
  private onScroll = (e: Event) => {
    const trigger = this.current?.trigger;
    if (!trigger) return;
    if (e.target instanceof Node && e.target !== document) {
      if (e.target.contains(trigger)) this.close(true);
      return;
    }
    // Scroll anchoring can fire a scroll event that scrolls nothing.
    if (scrollX !== this.scrolled[0] || scrollY !== this.scrolled[1]) this.close(true);
  };

  // -------------------------------------------------------------------------
  // Layout

  /** Fresh contents for the tip: its background layer, then `children`. */
  private fill(reveal: Reveal, ...children: (Node | string)[]) {
    const tip = this.element;
    const bg = document.createElement('div');
    bg.setAttribute('data-fp-tip-bg', '');
    Object.assign(bg.style, { position: 'absolute', inset: '0', zIndex: '-1', pointerEvents: 'none', userSelect: 'none' });
    tip.setAttribute('data-fp-tip', reveal);
    tip.removeAttribute('data-side');
    tip.style.removeProperty('--fp-tip-anchor');
    tip.replaceChildren(bg, ...children);
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.hidden = false;
    return bg;
  }

  /** Put the tip's top-left corner at `x`, `y` in the viewport. */
  private place(x: number, y: number) {
    this.element.style.left = `${x - this.frame.x}px`;
    this.element.style.top = `${y - this.frame.y}px`;
  }

  /**
   * The full text, laid over the line so its first grapheme sits exactly on
   * the original's. Text that runs past the window's edge, or past
   * `maxWidth`, wraps there (after `breaks`, where it can), and widens to the
   * left only when wrapping would make it narrower than `aspect`. It moves
   * up if it would run off the bottom.
   */
  private full(target: TooltipTarget, grow: boolean): boolean {
    const t = target.instance;
    const lines = t.lineRects();
    const first = lines[0];
    if (!first || t.graphemes.length === 0) return false;
    const origin = grow ? this.origin(t) : null;
    const font = getComputedStyle(t.element);

    const tip = this.element;
    for (const p of FONT) tip.style.setProperty(p, font.getPropertyValue(p));
    Object.assign(tip.style, {
      width: '',
      height: '',
      maxWidth: 'none',
      whiteSpace: 'nowrap',
      overflowWrap: '',
      userSelect: this.settings.selectable ? 'text' : '',
    });
    const spans = t.graphemes.map((g) => {
      const span = document.createElement('span');
      span.textContent = g;
      return span;
    });
    this.spans = spans;
    const text = document.createElement('span');
    text.append(...spans);
    const bg = this.fill(this.settings.reveal, text);

    const { edge, breaks, maxWidth, aspect } = this.settings;
    let box = tip.getBoundingClientRect();
    this.frame = { x: box.left, y: box.top };
    const head = spans[0]!.getBoundingClientRect();
    // Where its text starts in it: padding, and half the leading.
    const dx = head.left - box.left;
    const dy = head.top - box.top;
    const left = Math.min(...lines.map((l) => l.left));
    const right = Math.max(...lines.map((l) => l.right));
    const view = document.documentElement.clientWidth;
    const widest = Math.min(view - edge * 2, Math.max(right - left, view * maxWidth));
    let x = Math.min(Math.max(first.left - dx, edge), view - edge);
    const anchored = Math.min(view - edge - x, widest);
    if (box.width > anchored) {
      // (Chrome breaks at <wbr> even with nowrap, so they only go in now.)
      const after = new Set(breaks);
      spans.forEach((span, i) => after.has(t.graphemes[i]!) && span.after(document.createElement('wbr')));
      Object.assign(tip.style, { whiteSpace: '', overflowWrap: 'break-word' });
      const wide = (width: number) => {
        tip.style.maxWidth = `${width}px`;
        const r = tip.getBoundingClientRect();
        return r.width >= r.height * aspect;
      };
      // The narrowest width from where it starts to `widest` that's wide enough.
      let [lo, hi] = [anchored, widest];
      if (wide(lo)) hi = lo;
      while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        if (wide(mid)) hi = mid;
        else lo = mid;
      }
      tip.style.maxWidth = `${hi}px`;
      box = tip.getBoundingClientRect();
      x = Math.max(Math.min(x, view - edge - box.width), edge);
    }
    this.place(x, first.top - dy);
    box = tip.getBoundingClientRect();
    const targets = origin ? spans.map((span) => span.getBoundingClientRect()) : [];
    const bottom = innerHeight - edge;
    if (box.bottom > bottom) {
      const shift = Math.min(box.bottom - bottom, box.top - edge);
      this.place(box.left, box.top - shift);
      box = new DOMRect(box.left, box.top - shift, box.width, box.height);
      for (const r of targets) r.y -= shift;
    }
    if (!origin) return true;

    // The lines' box, padded like the tip: where the background grows from.
    const padRight = parseFloat(getComputedStyle(tip).paddingRight);
    const last = lines[lines.length - 1]!;
    const start = {
      left: left - dx,
      right: right + padRight,
      top: first.top - dy,
      bottom: last.bottom + dy,
    };
    this.grow(origin, targets, box, start, bg);
    return true;
  }

  /**
   * Where each grapheme is now: its own box, or for a hidden one, its place
   * in the ellipsis hiding it (spread across it, in order). And the marks of
   * every ellipsis, as drawn.
   */
  private origin(t: Elide): Origin {
    const from = t.graphemes.map((_, i) => t.graphemeRect(i));
    const part = t.graphemes.map(() => -1);
    const line = t.lineRects()[0]!;
    t.state.hidden.forEach(({ start, end }, j) => {
      const area = t.ellipsisArea(j) ?? line;
      const count = end - start;
      for (let k = 0; k < count; k++) {
        from[start + k] = new DOMRect(area.left + ((k + 0.5) / count) * area.width, area.top, 0, area.height);
        part[start + k] = j;
      }
    });
    const dots = t.state.hidden.flatMap((_, j) => t.markElements(j).map((el) => ({ el, rect: el.getBoundingClientRect() })));
    return { from: from.map((r) => r ?? line), part, dots };
  }

  /**
   * Every grapheme travels from where it was. Hidden ones come out of their
   * ellipsis, blurred, and only show once the others have made some room.
   * The marks stay where they are and fade, and the background grows from
   * the lines' box to the tip's.
   *
   * Inline text can't be transformed, so while it moves the text is taken
   * out of the flow, in runs set where they land, and the tip keeps its size.
   * A run is the graphemes on one line of the tip that move as one: shown
   * side by side, or out of the same ellipsis, which a run spreads from by
   * scaling, so each grapheme still travels from its own place in it. A few
   * runs moved by transforms leave the browser next to nothing to do on each
   * frame (a grapheme each would be thousands of layers). They're set in a
   * layer of their own, so the background growing doesn't lay them out, and
   * go back into the text when it lands.
   */
  private grow(
    origin: Origin,
    targets: DOMRect[],
    box: DOMRect,
    start: Record<'left' | 'right' | 'top' | 'bottom', number>,
    bg: HTMLElement,
  ) {
    const { duration, easing } = this.settings;
    const timing = { duration, easing, fill: 'backwards' } as const;
    const tip = this.element;
    const spans = this.spans;
    const { from, part } = origin;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    const runs: { start: number; end: number }[] = [];
    spans.forEach((_, i) => {
      const run = runs.at(-1);
      const a = run?.start ?? 0;
      const together =
        run &&
        part[i] === part[a] &&
        near(targets[i]!.top, targets[a]!.top) &&
        (part[i]! >= 0 ||
          (near(from[i]!.left - targets[i]!.left, from[a]!.left - targets[a]!.left) &&
            near(from[i]!.top - targets[i]!.top, from[a]!.top - targets[a]!.top)));
      if (together) run.end = i + 1;
      else runs.push({ start: i, end: i + 1 });
    });

    const text = spans[0]!.parentElement!;
    Object.assign(tip.style, { width: `${box.width}px`, height: `${box.height}px` });
    Object.assign(text.style, { position: 'absolute', inset: '0', contain: 'layout' });
    const groups = runs.map(({ start, end }) => {
      const group = document.createElement('span');
      spans[start]!.before(group);
      for (let node: ChildNode | null = spans[start]!; node;) {
        const next: ChildNode | null = node.nextSibling;
        group.append(node);
        node = node === spans[end - 1] ? null : next;
      }
      Object.assign(group.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: 'max-content',
        whiteSpace: 'nowrap',
        textIndent: '0',
      });
      return group;
    });
    // A run drops a space it starts with, which the text keeps, so each is
    // lined up by its first grapheme with any width.
    const lead = runs.map(({ start, end }) => {
      let i = start;
      while (i < end - 1 && targets[i]!.width === 0) i++;
      return i;
    });
    const range = document.createRange();
    const placed = groups.map((group, k) => {
      range.selectNodeContents(spans[lead[k]!]!);
      return { at: range.getBoundingClientRect(), own: group.getBoundingClientRect() };
    });

    groups.forEach((group, k) => {
      const { start, end } = runs[k]!;
      const i = lead[k]!;
      const { at, own } = placed[k]!;
      const dx = targets[i]!.left - at.left;
      group.style.left = `${dx}px`;
      group.style.top = `${targets[i]!.top - at.top}px`;
      const y = from[i]!.top - targets[i]!.top;
      if (part[i]! < 0) {
        group.animate([{ transform: `translate(${from[i]!.left - targets[i]!.left}px, ${y}px)` }, { transform: 'none' }], timing);
        return;
      }
      // Map the run's graphemes from where they land onto their places in the ellipsis.
      const left = own.left + dx;
      const center = (j: number) => targets[j]!.left + targets[j]!.width / 2 - left;
      const [a, b] = [start, end - 1];
      const width = center(b) - center(a);
      const scale = width > 0 ? (from[b]!.left - from[a]!.left) / width : 1;
      const x = from[a]!.left - left - scale * center(a);
      group.style.transformOrigin = '0 0';
      group.animate(
        [
          { transform: `translate(${x}px, ${y}px) scaleX(${scale})`, opacity: 0, filter: 'blur(3px)' },
          { offset: 0.15, opacity: 0 },
          { offset: 0.6, opacity: 1, filter: 'blur(0px)' },
          { transform: 'none', opacity: 1, filter: 'blur(0px)' },
        ],
        timing,
      );
    });

    for (const { el, rect } of origin.dots) {
      const dot = el.cloneNode(true) as HTMLElement;
      Object.assign(dot.style, {
        position: 'absolute',
        margin: '0',
        transform: 'none',
        pointerEvents: 'none',
        userSelect: 'none',
        left: `${rect.left - box.left}px`,
        top: `${rect.top - box.top}px`,
      });
      tip.append(dot);
      dot.animate({ opacity: [1, 0] }, { duration: duration * 0.35, fill: 'forwards' });
    }

    const inset = `${start.top - box.top}px ${box.right - start.right}px ${box.bottom - start.bottom}px ${start.left - box.left}px`;
    const growing = bg.animate([{ inset }, { inset: '0px' }], timing);
    this.landing = () => {
      for (const group of groups) group.removeAttribute('style');
      text.removeAttribute('style');
      Object.assign(tip.style, { width: '', height: '' });
    };
    growing.onfinish = () => this.land();
  }

  /** Finish the 'grow' animation now, with the text back in the flow. */
  private land() {
    const landing = this.landing;
    this.landing = null;
    for (const a of this.element.getAnimations({ subtree: true })) a.finish();
    landing?.();
  }

  /**
   * What ellipsis `target.ellipsis` hides, centred on its ink: above it, or
   * below when there's no room above, and kept inside the window.
   */
  private peek(target: TooltipTarget): boolean {
    const index = target.ellipsis ?? 0;
    const ink = target.instance.ellipsisInk(index);
    const part = target.instance.state.hidden[index];
    if (!ink || !part) return false;
    const tip = this.element;
    for (const p of FONT) tip.style.removeProperty(p);
    Object.assign(tip.style, { maxWidth: '', whiteSpace: '', overflowWrap: '', userSelect: '' });
    this.spans = [];
    this.fill('peek', part.text);

    const { edge, offset } = this.settings;
    const view = document.documentElement.clientWidth;
    let box = tip.getBoundingClientRect();
    this.frame = { x: box.left, y: box.top };
    if (box.width > view - edge * 2) {
      tip.style.maxWidth = `${view - edge * 2}px`;
      box = tip.getBoundingClientRect();
    }
    const center = ink.left + ink.width / 2;
    const x = Math.min(Math.max(center - box.width / 2, edge), view - edge - box.width);
    const above = ink.top - offset - box.height >= edge;
    this.place(x, above ? ink.top - offset - box.height : ink.bottom + offset);
    tip.setAttribute('data-side', above ? 'top' : 'bottom');
    tip.style.setProperty('--fp-tip-anchor', `${center - x}px`);
    return true;
  }

  // -------------------------------------------------------------------------
  // Selecting text in the tip
  //
  // The tip ignores the pointer, so hovering what's under it keeps working.
  // But a press that lands on it (with a mouse or pen) is the tip's: it takes
  // the pointer, the press starts a selection in its text, and dragging
  // extends it, clamped to the tip's text. The press also holds the tip open
  // while it's hovered, and for as long as it holds a selection. When the
  // pointer leaves it with nothing selected, it stays open (no longer held)
  // if the pointer is back on its trigger, and closes otherwise. A press
  // elsewhere lets go of it and closes it.

  private selectable() {
    return this.settings.selectable && this.current !== null && this.settings.reveal !== 'peek' && this.spans.length > 0;
  }

  private inside(x: number, y: number) {
    const r = this.element.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private selectionInTip() {
    const s = document.getSelection();
    return !!s && !s.isCollapsed && this.element.contains(s.anchorNode) && this.element.contains(s.focusNode);
  }

  private hold(on: boolean) {
    this.holding = on;
    this.element.style.pointerEvents = on ? 'auto' : 'none';
    this.element.style.cursor = on ? 'text' : '';
    this.element.toggleAttribute('data-held', on);
  }

  /** Let go of a held tip, dropping any selection in it. */
  private release() {
    this.dragging = false;
    if (!this.holding) return;
    this.hold(false);
    if (this.selectionInTip()) document.getSelection()!.removeAllRanges();
  }

  /** The pointer is off the tip: back to a plain hover tip over its trigger, or closed. */
  private leave(x: number, y: number) {
    if (!this.holding || this.dragging || this.selectionInTip()) return;
    this.hold(false);
    if (!this.current?.trigger.contains(document.elementFromPoint(x, y))) this.close();
  }

  private onPress = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    if (!this.selectable() || !this.inside(e.clientX, e.clientY)) {
      if (this.holding) this.close(true);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const tip = this.element;
    this.land();
    this.hold(true);
    tip.setPointerCapture(e.pointerId);
    const p = this.presses;
    const again = e.timeStamp - p.time < 500 && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5;
    this.presses = { count: again ? p.count + 1 : 1, time: e.timeStamp, x: e.clientX, y: e.clientY };
    const at = this.caretAt(e.clientX, e.clientY);
    if (at === null) return;
    if (this.presses.count === 2) return this.selectAround(at);
    if (this.presses.count >= 3) return this.select(0, this.spans.length);
    this.anchor = at;
    this.dragging = true;
    this.select(at, at);
  };

  private onDrag = (e: PointerEvent) => {
    if (!this.dragging) return;
    const at = this.caretAt(e.clientX, e.clientY);
    if (at !== null) this.select(this.anchor, at);
  };

  private onRelease = (e: PointerEvent) => {
    if (!this.holding) return;
    this.dragging = false;
    if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    if (!this.inside(e.clientX, e.clientY)) this.leave(e.clientX, e.clientY);
  };

  /** The grapheme boundary under a point, with the point first pulled inside the tip's text. */
  private caretAt(x: number, y: number): number | null {
    const tip = this.element;
    const r = tip.getBoundingClientRect();
    const cs = getComputedStyle(tip);
    x = Math.min(Math.max(x, r.left + parseFloat(cs.paddingLeft) + 1), r.right - parseFloat(cs.paddingRight) - 1);
    y = Math.min(Math.max(y, r.top + parseFloat(cs.paddingTop) + 1), r.bottom - parseFloat(cs.paddingBottom) - 1);
    const caret = document.caretPositionFromPoint(x, y);
    const node = caret?.offsetNode;
    const offset = caret?.offset ?? 0;
    if (!node || !tip.contains(node)) return null;
    const span = node.parentElement;
    const i = span ? this.spans.indexOf(span) : -1;
    if (node instanceof Text && i >= 0) return offset > 0 ? i + 1 : i;
    // An element: the first grapheme at or after that child, else the end.
    const child = node.childNodes[offset] ?? null;
    const after = child
      ? this.spans.findIndex(
          (s) => child === s || child.contains(s) || (child.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        )
      : -1;
    return after >= 0 ? after : this.spans.length;
  }

  /** Select graphemes from boundary `from` to boundary `to` (either way round). */
  private select(from: number, to: number) {
    const at = (i: number): [Node, number] => {
      const span = this.spans[Math.min(i, this.spans.length - 1)]!;
      return [span.firstChild!, i < this.spans.length ? 0 : (span.textContent ?? '').length];
    };
    if (this.spans.length === 0) return;
    document.getSelection()?.setBaseAndExtent(...at(from), ...at(to));
  }

  /** Select the run around a boundary, between spaces and `breaks`. */
  private selectAround(at: number) {
    const g = this.current?.instance.graphemes ?? [];
    const stop = (s: string) => /\s/.test(s) || this.settings.breaks.includes(s);
    let a = at;
    let b = at;
    while (a > 0 && !stop(g[a - 1]!)) a--;
    while (b < g.length && !stop(g[b]!)) b++;
    if (a === b) b = Math.min(g.length, b + 1);
    this.select(a, b);
  }

  /**
   * If the page's selection lies wholly inside the element, select the same
   * text in the tip: where it touches an ellipsis, all the ellipsis hides.
   * That doesn't hold the tip, and when it closes, the original comes back.
   */
  private carrySelection(t: Elide) {
    const s = document.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) return;
    const range = s.getRangeAt(0);
    if (!t.element.contains(range.startContainer) || !t.element.contains(range.endContainer)) return;
    const from = t.graphemeAt(range.startContainer, range.startOffset, 'start');
    const to = t.graphemeAt(range.endContainer, range.endOffset, 'end');
    if (from === null || to === null || to <= from) return;
    const original = range.cloneRange();
    this.select(from, to);
    if (this.element.contains(s.anchorNode)) this.carried = { text: s.toString(), original };
  }

  /** Drop the selection in the tip; one it was only carrying goes back where it came from. */
  private restoreSelection() {
    const carried = this.carried;
    this.carried = null;
    const s = document.getSelection();
    if (!s || !this.element.contains(s.anchorNode)) return;
    const unchanged = carried && s.toString() === carried.text;
    s.removeAllRanges();
    if (unchanged) s.addRange(carried.original);
  }
}

/** What a full-text tip takes from the text, so its glyphs land on the original's. */
const FONT = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'font-feature-settings',
  'font-variation-settings',
  'font-kerning',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-transform',
];

/** A tooltip for truncated text. Attach instances to it; call `destroy()` to remove it. */
export function tooltip(options?: TooltipOptions): Tooltip {
  return new Tooltip(options);
}
