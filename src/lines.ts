/** Reading the lines of laid-out inline text. Each of these reads layout. */

/** A rendered line: its vertical extent and its edges. */
export interface LineBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * How much transforms on the element and its ancestors (a zoomed canvas)
 * scale it on screen along each axis, as the screen pixels of its rects per
 * CSS pixel of its layout. Rects divided by it are in the same pixels as
 * widths measured from the font, computed styles and the ResizeObserver,
 * which transforms don't change (and neither does where lines wrap).
 */
export interface Scale {
  x: number;
  y: number;
}

/**
 * The scale of `el`, whose border box is `box` on screen: its size there
 * against its size in layout. 1 where they agree, or where there's no size
 * to tell by.
 */
export function scaleOf(el: HTMLElement, cs: CSSStyleDeclaration, box: DOMRectReadOnly): Scale {
  const px = (p: string) => parseFloat(cs.getPropertyValue(p));
  const along = (screen: number, size: string, offset: number, client: number, edges: string[]) => {
    const scale = (css: number, near: number) => (css > 0 && screen > 0 && Math.abs(screen - css) > near ? screen / css : 1);
    const used = px(size);
    // An inline element has no used size, only its offset size, rounded.
    if (!Number.isFinite(used)) return scale(offset, 1);
    if (cs.boxSizing === 'border-box') return scale(used, 0.01);
    const [a, b, borderA, borderB] = edges.map(px) as [number, number, number, number];
    // A content box's size leaves out a scrollbar beside it (see `contentEdges`).
    const gutter = offset - client - Math.round(borderA + borderB);
    return scale(used + a + b + borderA + borderB + (gutter > 1 ? gutter : 0), 0.01);
  };
  return {
    x: along(box.width, 'width', el.offsetWidth, el.clientWidth, [
      'padding-left',
      'padding-right',
      'border-left-width',
      'border-right-width',
    ]),
    y: along(box.height, 'height', el.offsetHeight, el.clientHeight, [
      'padding-top',
      'padding-bottom',
      'border-top-width',
      'border-bottom-width',
    ]),
  };
}

/** The scale of `el` as it is laid out now (see `scaleOf`). Reads layout. */
export function scaleNow(el: HTMLElement): Scale {
  return scaleOf(el, getComputedStyle(el), el.getBoundingClientRect());
}

/** `r`, a rect on screen, in the CSS pixels of an element scaled by `scale`. */
export function unscaled(r: DOMRectReadOnly | LineBox, scale: Scale): LineBox {
  return { top: r.top / scale.y, bottom: r.bottom / scale.y, left: r.left / scale.x, right: r.right / scale.x };
}

/**
 * The lines `els` (inline elements, side by side, in an element scaled by
 * `scale`) are laid out on, top to bottom, in CSS pixels. A line can come
 * back as several boxes, empty ones among them, and of different heights
 * where the font changes: boxes that share a top, or whose middles lie on
 * the same line, are merged.
 */
export function lineBoxes(els: readonly Element[], scale: Scale): LineBox[] {
  const lines: LineBox[] = [];
  for (const el of els) {
    for (const rect of el.getClientRects()) {
      const r = unscaled(rect, scale);
      const middle = (r.top + r.bottom) / 2;
      const line = lines.find((l) => Math.abs(l.top - r.top) < 1 || (middle >= l.top && middle <= l.bottom));
      if (line) {
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
      } else {
        lines.push(r);
      }
    }
  }
  return lines.sort((a, b) => a.top - b.top);
}

/**
 * How many lines `els` are laid out on, whether they all lie between `left`
 * and `right`, and where the rightmost box ends (see `lineBoxes`).
 */
export function lineSpan(
  els: readonly Element[],
  scale: Scale,
  left: number,
  right: number,
): { lines: number; inside: boolean; end: number } {
  const lines = lineBoxes(els, scale);
  return {
    lines: lines.length,
    inside: lines.every((l) => l.right <= right + 0.05 && l.left >= left - 0.05),
    end: lines.reduce((end, l) => Math.max(end, l.right), -Infinity),
  };
}

/**
 * The left and right edges of `el`'s content box, from its unrounded border
 * box in CSS pixels (`clientWidth` is rounded to a whole pixel, which can
 * leave the text overflowing), less a scrollbar.
 */
export function contentEdges(el: HTMLElement, cs: CSSStyleDeclaration, box: LineBox): { left: number; right: number } {
  const borderLeft = parseFloat(cs.borderLeftWidth);
  const borderRight = parseFloat(cs.borderRightWidth);
  // (Those two widths are rounded separately: a pixel's difference is no scrollbar.)
  const gutter = el.offsetWidth - el.clientWidth - Math.round(borderLeft + borderRight);
  return {
    left: box.left + borderLeft + parseFloat(cs.paddingLeft),
    right: box.right - borderRight - parseFloat(cs.paddingRight) - (gutter > 1 ? gutter : 0),
  };
}

/** The height of `el`'s content box, unrounded and in CSS pixels (as a ResizeObserver reports it). */
export function contentHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v);
  const box = el.getBoundingClientRect();
  return box.height / scaleOf(el, cs, box).y - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth);
}

/** Set an inline style on `el`, over any other; returns what gives it its own value back. */
export function holdStyle(el: HTMLElement, property: string, value: string): () => void {
  const style = el.style;
  const own = [style.getPropertyValue(property), style.getPropertyPriority(property)] as const;
  style.setProperty(property, value, 'important');
  return () => style.setProperty(property, ...own);
}
