/**
 * The text-mode pieces of a line (a visible run, or the grapheme kept beside
 * an ellipsis) with highlights in them: classes from `keep` wrap stretches of
 * a piece's text in spans. Finding a grapheme in a piece goes through these.
 */
import type { Range } from './cut.ts';

/** Graphemes `[from, to)` as stretches that share their class, joined. */
function classRuns(
  graphemes: readonly string[],
  classes: readonly (string | null)[],
  from: number,
  to: number,
): [cls: string | null, text: string][] {
  const runs: [string | null, string][] = [];
  for (let i = from; i < to; i++) {
    const cls = classes[i] ?? null;
    const last = runs.at(-1);
    if (last && last[0] === cls) last[1] += graphemes[i]!;
    else runs.push([cls, graphemes[i]!]);
  }
  return runs;
}

/** What each piece was last filled with, so filling it again is free. */
const filled = new WeakMap<HTMLElement, string>();

/**
 * Make `el` hold graphemes `[from, to)`: plain text, or text and spans for
 * stretches with a class. Touches the DOM as little as possible. A highlight
 * that goes on into the piece beside it, within the visible run `shown` (a
 * grapheme kept with an ellipsis is a piece of its own), says so to CSS with
 * `data-fp-open` ('start', 'end').
 */
export function fillPiece(
  el: HTMLElement,
  graphemes: readonly string[],
  classes: readonly (string | null)[],
  [from, to]: Range,
  shown: Range,
): void {
  const runs = classRuns(graphemes, classes, from, to);
  const open = {
    start: from > shown[0] && from < to && classes[from - 1] === classes[from],
    end: to < shown[1] && from < to && classes[to] === classes[to - 1],
  };
  if (runs.every(([cls]) => cls === null)) {
    filled.delete(el);
    const text = runs.map(([, t]) => t).join('');
    const node = el.firstChild;
    if (node instanceof Text && el.childNodes.length === 1) {
      if (node.data !== text) node.data = text;
    } else if (el.childNodes.length > 0 || text !== '') {
      el.textContent = text;
    }
    return;
  }
  const key = JSON.stringify([runs, open]);
  if (filled.get(el) === key) return;
  filled.set(el, key);
  el.replaceChildren(
    ...runs.map(([cls, text], i) => {
      if (cls === null) return document.createTextNode(text);
      const span = document.createElement('span');
      span.className = cls;
      span.setAttribute('data-fp-kept', '');
      const sides = [i === 0 && open.start ? 'start' : '', i === runs.length - 1 && open.end ? 'end' : ''].filter(Boolean);
      if (sides.length > 0) span.setAttribute('data-fp-open', sides.join(' '));
      span.textContent = text;
      return span;
    }),
  );
}

/**
 * The text node holding code unit `at` of a piece's text, and the offset in
 * it: the piece's own text, or a highlight's.
 */
export function textAt(el: HTMLElement, at: number): [Text, number] | null {
  for (const child of el.childNodes) {
    const node = child instanceof Text ? child : child.firstChild;
    const length = child.textContent?.length ?? 0;
    if (at < length && node instanceof Text) return [node, at];
    at -= length;
  }
  return null;
}

/**
 * The graphemes each child of a piece holding `[from, to)` spells, and the
 * text node inside a highlight too. `offsets[i]` is where grapheme `i` starts.
 */
export function childRanges(el: HTMLElement, [from, to]: Range, offsets: readonly number[]): [Node, Range][] {
  const out: [Node, Range][] = [];
  let i = from;
  for (const child of el.childNodes) {
    const start = i;
    const end = offsets[start]! + (child.textContent ?? '').length;
    while (i < to && offsets[i]! < end) i++;
    out.push([child, [start, i]]);
    if (child.firstChild) out.push([child.firstChild, [start, i]]);
  }
  return out;
}
