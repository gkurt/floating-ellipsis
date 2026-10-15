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

/** Set an inline style on `el`, over any other; returns what gives it its own value back. */
export function holdStyle(el: HTMLElement, property: string, value: string): () => void {
  const style = el.style;
  const own = [style.getPropertyValue(property), style.getPropertyPriority(property)] as const;
  style.setProperty(property, value, 'important');
  return () => style.setProperty(property, ...own);
}
