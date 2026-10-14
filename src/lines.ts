/** Reading the lines of laid-out inline text. Each of these reads layout. */

/** A rendered line: its vertical extent and its edges. */
export interface LineBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The lines `el` (an inline element) is laid out on, top to bottom. A line
 * can come back as several boxes, so boxes sharing a top are merged.
 */
export function lineBoxes(el: Element): LineBox[] {
  const lines: LineBox[] = [];
  for (const r of el.getClientRects()) {
    const line = lines.find((l) => Math.abs(l.top - r.top) < 1);
    if (line) {
      line.bottom = Math.max(line.bottom, r.bottom);
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
    } else {
      lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
  }
  return lines.sort((a, b) => a.top - b.top);
}

/**
 * How many lines `el` is laid out on, whether it all lies between `left` and
 * `right`, and where its rightmost box ends.
 */
export function lineSpan(el: Element, left: number, right: number): { lines: number; inside: boolean; end: number } {
  let lines = 0;
  let lastTop = NaN;
  let inside = true;
  let end = -Infinity;
  for (const r of el.getClientRects()) {
    if (!(Math.abs(r.top - lastTop) < 1)) lines++;
    lastTop = r.top;
    end = Math.max(end, r.right);
    if (r.right > right + 0.05 || r.left < left - 0.05) inside = false;
  }
  return { lines, inside, end };
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
