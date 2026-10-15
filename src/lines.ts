/** Reading the lines of laid-out inline text. Each of these reads layout. */

/** A rendered line: its vertical extent and its edges. */
export interface LineBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The lines `els` (inline elements, side by side) are laid out on, top to
 * bottom. A line can come back as several boxes, empty ones among them, and
 * of different heights where the font changes: boxes that share a top, or
 * whose middles lie on the same line, are merged.
 */
export function lineBoxes(...els: Element[]): LineBox[] {
  const lines: LineBox[] = [];
  for (const el of els) {
    for (const r of el.getClientRects()) {
      const middle = (r.top + r.bottom) / 2;
      const line = lines.find((l) => Math.abs(l.top - r.top) < 1 || (middle >= l.top && middle <= l.bottom));
      if (line) {
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
      } else {
        lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      }
    }
  }
  return lines.sort((a, b) => a.top - b.top);
}

/**
 * How many lines `els` are laid out on, whether they all lie between `left`
 * and `right`, and where the rightmost box ends.
 */
export function lineSpan(els: readonly Element[], left: number, right: number): { lines: number; inside: boolean; end: number } {
  const lines = lineBoxes(...els);
  return {
    lines: lines.length,
    inside: lines.every((l) => l.right <= right + 0.05 && l.left >= left - 0.05),
    end: lines.reduce((end, l) => Math.max(end, l.right), -Infinity),
  };
}

/**
 * The left and right edges of `el`'s content box, from its unrounded border
 * box (`clientWidth` is rounded to a whole pixel, which can leave the text
 * overflowing), less a scrollbar.
 */
export function contentEdges(el: HTMLElement, cs: CSSStyleDeclaration, box: DOMRect): { left: number; right: number } {
  const borderLeft = parseFloat(cs.borderLeftWidth);
  const borderRight = parseFloat(cs.borderRightWidth);
  // (Those two widths are rounded separately: a pixel's difference is no scrollbar.)
  const gutter = el.offsetWidth - el.clientWidth - Math.round(borderLeft + borderRight);
  return {
    left: box.left + borderLeft + parseFloat(cs.paddingLeft),
    right: box.right - borderRight - parseFloat(cs.paddingRight) - (gutter > 1 ? gutter : 0),
  };
}

/** The height of `el`'s content box, unrounded (as a ResizeObserver reports it). */
export function contentHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v);
  return el.getBoundingClientRect().height - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth);
}

/**
 * The space `el` (an ellipsis) takes up between the text either side of it:
 * its box and margins, over the height of its line, one of `lines`.
 */
export function areaOf(el: Element, lines: readonly DOMRect[]): DOMRect {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const left = r.left - parseFloat(cs.marginLeft);
  const right = r.right + parseFloat(cs.marginRight);
  const middle = r.top + r.height / 2;
  const line = lines.find((l) => middle >= l.top && middle <= l.bottom);
  const top = Math.min(r.top, line?.top ?? r.top);
  const bottom = Math.max(r.bottom, line?.bottom ?? r.bottom);
  return new DOMRect(left, top, Math.max(0, right - left), bottom - top);
}

/** Set an inline style on `el`, over any other; returns what gives it its own value back. */
export function holdStyle(el: HTMLElement, property: string, value: string): () => void {
  const style = el.style;
  const own = [style.getPropertyValue(property), style.getPropertyPriority(property)] as const;
  style.setProperty(property, value, 'important');
  return () => style.setProperty(property, ...own);
}

/** Index of the box (of `boxes`, `slop` wider all round) that holds the point, or -1. */
export function indexAt(boxes: readonly (DOMRect | null)[], x: number, y: number, slop: number): number {
  return boxes.findIndex((a) => !!a && x >= a.left - slop && x < a.right + slop && y >= a.top - slop && y < a.bottom + slop);
}

/** The box around `rects`, or null when there are none. */
export function boundsOf(rects: readonly DOMRect[]): DOMRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}
