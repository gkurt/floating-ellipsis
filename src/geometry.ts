/**
 * Where an instance's text, ellipses and marks are laid out
 * (`floating-ellipsis/geometry`), in viewport coordinates, and what's at a
 * point or a DOM position. Each reads layout, after running a pending pass.
 */
import type { Range } from './cut.ts';
import type { Elide, Inside } from './elide.ts';
import { FORM } from './highlight.ts';
import { inside } from './inside.ts';
import { lineBoxes } from './lines.ts';
import { markInk } from './marks.ts';
import { UNIT_COPY } from './markup.ts';
import { isVisible } from './options.ts';

/** Index of the ellipsis containing `node` (e.g. an event target), or -1. */
export function ellipsisIndex(instance: Elide, node: Node | null): number {
  return node ? instance.ellipses.findIndex((e) => e.contains(node)) : -1;
}

/** Box of ellipsis `index`, or null. */
export function ellipsisRect(instance: Elide, index = 0): DOMRect | null {
  const e = instance.ellipses[index];
  return e ? e.getBoundingClientRect() : null;
}

/** Tight box around the ink of ellipsis `index`, or null. */
export function ellipsisInk(instance: Elide, index = 0): DOMRect | null {
  return boundsOf(markInks(instance, index));
}

/**
 * The space ellipsis `index` takes up between the text before and after it
 * (its box plus the gaps either side, over the height of its line), or null.
 * Where the hidden text would go, and a generous hover target: see `ellipsisAt`.
 */
export function ellipsisArea(instance: Elide, index = 0): DOMRect | null {
  const e = instance.ellipses[index];
  return e ? areaOf(e, lineRects(instance)) : null;
}

/**
 * Index of the ellipsis whose area (see `ellipsisArea`) contains the point,
 * in client coordinates (e.g. a pointer event's), or -1. Unlike the ellipsis
 * element, which only spans its marks, this covers the gaps too. `slop`
 * widens every area by that many pixels on each side.
 */
export function ellipsisAt(instance: Elide, x: number, y: number, slop = 0): number {
  return indexAt(
    instance.ellipses.map((_, i) => ellipsisArea(instance, i)),
    x,
    y,
    slop,
  );
}

/**
 * Ink box of each mark of ellipsis `index`: each dot, bullet or character.
 * For a single glyph like '…' the dots are found in the glyph itself.
 */
export function markInks(instance: Elide, index = 0): DOMRect[] {
  const s = inside(instance);
  s.sync();
  const join = s.joins[index];
  const layout = s.run?.marks;
  if (!join || !layout || index >= (s.current?.hidden.length ?? 0)) return [];
  // More marks than measured are repeated ones (see `MarkLayout.repeats`).
  return join.marks.length === layout.metrics.length || (layout.repeats && join.marks.length > layout.metrics.length)
    ? markInk(layout, join.marks, join.ellipsis)
    : [];
}

/**
 * The elements drawing the marks of ellipsis `index`. A single glyph like
 * '…' is one element even though `markInks()` reports its dots separately.
 */
export function markElements(instance: Elide, index = 0): HTMLElement[] {
  const s = inside(instance);
  s.sync();
  return index < (s.current?.hidden.length ?? 0) ? [...(s.joins[index]?.marks ?? [])] : [];
}

/**
 * The element part `index` of `state.short` shows as in the line (its short
 * form, see `shorten`), or null.
 */
export function shortElement(instance: Elide, index = 0): HTMLElement | null {
  const s = inside(instance);
  s.sync();
  const part = s.current?.short[index];
  if (!part) return null;
  for (const el of s.line.querySelectorAll<HTMLElement>(`[${FORM}]`)) {
    const [start] = formRange(el);
    if (start === part.start && !el.closest('[data-fp-found]')) return el;
  }
  return null;
}

/** Box of part `index` of `state.short` as it shows, in its short form, or null. */
export function shortRect(instance: Elide, index = 0): DOMRect | null {
  return shortElement(instance, index)?.getBoundingClientRect() ?? null;
}

/** The graphemes a short form's element stands for (see `shortCopy`). */
function formRange(el: Element): Range {
  const [, start, end] = (el.getAttribute(FORM) ?? '').split(':').map(Number);
  return [start ?? 0, end ?? 0];
}

/** One box per rendered line of visible text. */
export function lineRects(instance: Elide): DOMRect[] {
  const s = inside(instance);
  s.sync();
  return lineBoxes(s.line).map((l) => new DOMRect(l.left, l.top, l.right - l.left, l.bottom - l.top));
}

/**
 * Box of grapheme `index` as laid out, or null when it is hidden, or in a
 * part showing its short form (see `shortRect`). Works in text mode too
 * (measured with a Range), so a tooltip can line its own copy of the text up
 * with the original glyph by glyph.
 */
export function graphemeRect(instance: Elide, index: number): DOMRect | null {
  const s = inside(instance);
  s.sync();
  const { current, offsets } = s;
  if (index < 0 || index >= instance.graphemes.length || !current || !isVisible(current, index)) return null;
  if (current.short.some((p) => index >= p.start && index < p.end)) return null;
  if (s.settings.glyphs) {
    const el = s.glyphs[index];
    return el?.isConnected ? el.getBoundingClientRect() : null;
  }
  const piece = s.pieces().find(({ range: [a, b] }) => index >= a && index < b);
  if (!piece) return null;
  if (instance.unitOf(index)) return piece.el.querySelector(`[${UNIT_COPY}="${index}"]`)?.getBoundingClientRect() ?? null;
  const found = textAt(piece.el, offsets[index]! - offsets[piece.range[0]]!, (a, b) => offsets[b]! - offsets[a]!);
  if (!found) return null;
  const [node, at] = found;
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + (offsets[index + 1]! - offsets[index]!));
  return range.getBoundingClientRect();
}

/**
 * Grapheme index (in the full text) of a DOM position in the element's text,
 * such as either end of a selection, or null when it isn't in the visible
 * text. A position inside an ellipsis stands for the start of what it hides
 * when `side` is 'start', for its end when 'end': a range that touches an
 * ellipsis covers all it hides, as copying it does.
 */
export function graphemeAt(instance: Elide, node: Node, offset: number, side: 'start' | 'end' = 'start'): number | null {
  const s = inside(instance);
  s.sync();
  const { current, offsets } = s;
  if (!current || !s.line.contains(node)) return null;
  const j = ellipsisIndex(instance, node);
  if (j >= 0) return side === 'start' ? current.hidden[j]!.start : current.hidden[j]!.end;
  const pieces = piecesOf(instance, s);
  if (node instanceof Text) {
    const range = pieces.get(node) ?? (node.parentElement ? pieces.get(node.parentElement) : undefined);
    if (!range) return null;
    const at = offsets[range[0]]! + offset;
    let i = range[0];
    while (i < range[1] && offsets[i]! < at) i++;
    return i;
  }
  // An element: the boundary before its child at `offset`, or its end.
  const child = node.childNodes[offset];
  if (!child) return pieces.get(node)?.[1] ?? null;
  // (In glyph mode a glyph's text isn't mapped: its element is.)
  return (pieces.get(child) ?? (child instanceof Text ? pieces.get(node) : undefined))?.[0] ?? null;
}

/** The graphemes each element of the visible text holds, as rendered now. */
function piecesOf(instance: Elide, s: Inside): Map<Node, Range> {
  const hidden = s.current?.hidden ?? [];
  const glyphMode = !!s.settings.glyphs;
  const map = new Map<Node, Range>([[s.line, [0, instance.graphemes.length]]]);
  // An element holding text, and in text mode each text node and highlight in it.
  const hold = (el: HTMLElement, range: Range, glyphs = glyphMode) => {
    map.set(el, range);
    if (!glyphs) for (const [node, r] of childRanges(el, range, s.offsets)) map.set(node, r);
  };
  for (const { el, range } of s.pieces()) hold(el, range);
  hidden.forEach((part, j) => {
    const join = s.joins[j]!;
    map.set(join.ellipsis, [part.start, part.end]);
    hold(join.found, [part.start, part.end], false);
    map.set(join.el, [map.get(join.before)![0], map.get(join.after)![1]]);
  });
  if (glyphMode) s.glyphs.forEach((el, i) => map.set(el, [i, i + 1]));
  // A short form stands for all of its part, whatever in it a position is in.
  for (const el of s.line.querySelectorAll(`[${FORM}]`)) {
    const range = formRange(el);
    for (const node of [el, ...el.querySelectorAll('*')]) map.set(node, range);
  }
  return map;
}

/**
 * The space `el` (an ellipsis) takes up between the text either side of it:
 * its box and margins, over the height of its line, one of `lines`.
 */
function areaOf(el: Element, lines: readonly DOMRect[]): DOMRect {
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

/** Index of the box (of `boxes`, `slop` wider all round) that holds the point, or -1. */
function indexAt(boxes: readonly (DOMRect | null)[], x: number, y: number, slop: number): number {
  return boxes.findIndex((a) => !!a && x >= a.left - slop && x < a.right + slop && y >= a.top - slop && y < a.bottom + slop);
}

/** The box around `rects`, or null when there are none. */
function boundsOf(rects: readonly DOMRect[]): DOMRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * The text node holding code unit `at` of a piece's text, and the offset in
 * it. A unit's copy stands for its grapheme's text, and a short form for its
 * part's, `length(start, end)` long.
 */
function textAt(el: Element, at: number, length: (start: number, end: number) => number): [Text, number] | null {
  const find = (node: Node): [Text, number] | null => {
    if (node instanceof Text) {
      if (at < node.data.length) return [node, at];
      at -= node.data.length;
      return null;
    }
    const unit = node instanceof Element ? node.getAttribute(UNIT_COPY) : null;
    if (unit !== null) {
      at -= length(Number(unit), Number(unit) + 1);
      return null;
    }
    if (node instanceof Element && node.hasAttribute(FORM)) {
      at -= length(...formRange(node));
      return null;
    }
    for (const child of node.childNodes) {
      const found = find(child);
      if (found || at < 0) return found;
    }
    return null;
  };
  return find(el);
}

/**
 * The graphemes each node in a piece holding `[from, to)` spells: every
 * element and text node in it, and all of a unit's copy its grapheme.
 * `offsets[i]` is where grapheme `i` starts.
 */
function childRanges(el: HTMLElement, [from, to]: Range, offsets: readonly number[]): [Node, Range][] {
  const out: [Node, Range][] = [];
  let i = from;
  const visit = (node: Node) => {
    const start = i;
    if (node instanceof Element && node.hasAttribute(UNIT_COPY)) {
      i++;
      for (const inner of node.querySelectorAll('*')) out.push([inner, [start, i]]);
    } else if (node instanceof Element && node.hasAttribute(FORM)) {
      i = Math.max(i, formRange(node)[1]);
      return;
    } else if (node instanceof Text) {
      const end = offsets[start]! + node.data.length;
      while (i < to && offsets[i]! < end) i++;
    } else {
      for (const child of node.childNodes) visit(child);
    }
    out.push([node, [start, i]]);
  };
  for (const child of el.childNodes) visit(child);
  return out;
}
