/**
 * The text-mode pieces of a line (a visible run, or the grapheme kept beside
 * an ellipsis) with highlights in them: classes from `keep` wrap stretches of
 * a piece's text in spans. Finding a grapheme in a piece goes through these.
 */
import type { Range } from './cut.ts';

/** Graphemes `[from, to)` as stretches that share their class, joined. */
export function classRuns(
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

/** Make `el` hold `runs`: plain text, or text and highlight spans. Touches the DOM as little as possible. */
export function fillPiece(el: HTMLElement, runs: readonly [string | null, string][]): void {
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
  const key = JSON.stringify(runs);
  if (filled.get(el) === key) return;
  filled.set(el, key);
  el.replaceChildren(
    ...runs.map(([cls, text]) => {
      if (cls === null) return document.createTextNode(text);
      const span = document.createElement('span');
      span.className = cls;
      span.setAttribute('data-fp-kept', '');
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
