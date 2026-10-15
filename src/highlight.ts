/**
 * The pieces of a line (a visible run, the grapheme kept beside an ellipsis,
 * or the text an ellipsis hides) with highlights and markup in them: classes
 * from `keep` wrap stretches of a piece's text in spans, and copies of the
 * text's own elements go around those. Finding a grapheme in a piece goes
 * through these.
 */
import type { Range } from './cut.ts';
import { type Chain, type Placed, nest } from './markup.ts';

/** How each grapheme is marked up: the classes `keep` gives it, the elements around it, and what find in page found. */
export interface Marking {
  classes: readonly (string | null)[];
  /** Empty when the text has no elements. */
  chains: readonly (Chain | null)[];
  /** What find in page found, kept in sight (see `find`). */
  match: Range | null;
  /** No grapheme has a class or an element around it. */
  plain: boolean;
  /** The whole text, and where each grapheme starts in it (length n + 1). */
  text: string;
  offsets: readonly number[];
}

/** Whether graphemes `[from, to)` are plain text, with nothing to wrap them in. */
const plainIn = ({ plain, match }: Marking, from: number, to: number) => plain && (!match || match[1] <= from || match[0] >= to);

/** Graphemes `[from, to)` as stretches that share their class, elements and being found. */
function stretches(graphemes: readonly string[], { classes, chains, match }: Marking, from: number, to: number) {
  const out: { cls: string | null; chain: Chain | null; found: boolean; start: number; end: number; text: string }[] = [];
  for (let i = from; i < to; i++) {
    const cls = classes[i] ?? null;
    const chain = chains[i] ?? null;
    const found = !!match && i >= match[0] && i < match[1];
    const last = out.at(-1);
    if (last && last.cls === cls && last.chain === chain && last.found === found) {
      last.end = i + 1;
      last.text += graphemes[i]!;
    } else {
      out.push({ cls, chain, found, start: i, end: i + 1, text: graphemes[i]! });
    }
  }
  return out;
}

const chainIds = new WeakMap<Chain, number>();
let nextChain = 1;
export const chainId = (chain: Chain | null): number => {
  if (!chain) return 0;
  let id = chainIds.get(chain);
  if (id === undefined) chainIds.set(chain, (id = nextChain++));
  return id;
};

/**
 * How many graphemes of `[a, b)`, from its end at `edge`, sit with the
 * ellipsis there: one, or as much as is highlighted, found or in the same
 * element, so the element isn't split off a grapheme of it. Text that
 * `wraps` keeps its line breaks: that stops at a space, or where one word
 * runs straight into the next, as in Chinese or Japanese (`words`: `wordsOf`).
 */
export function besideEllipsis(
  marking: Marking,
  graphemes: readonly string[],
  wordsOf: () => Int32Array,
  [a, b]: Range,
  edge: number,
  wraps: boolean,
): number {
  if (a >= b) return 0;
  if (plainIn(marking, edge, edge + 1)) return 1;
  const { classes, chains, match } = marking;
  const words = wordsOf();
  const mark = (i: number) => `${classes[i] ?? ''}|${chainId(chains[i] ?? null)}|${!!match && i >= match[0] && i < match[1]}`;
  const own = mark(edge);
  if (own === '|0|false') return 1;
  const step = edge === a ? 1 : -1;
  let k = 1;
  for (let i = edge + step; i >= a && i < b && mark(i) === own; i += step) {
    const prev = words[i - step]!;
    if (wraps && (/^\s+$/u.test(graphemes[i]!) || (prev >= 0 && words[i]! >= 0 && words[i] !== prev))) break;
    k++;
  }
  return k;
}

/** What each piece was last filled with, so filling it again is free. */
export const filled = new WeakMap<HTMLElement, string>();

/**
 * Make `el` hold graphemes `[from, to)`: plain text, or text in spans for
 * stretches with a class and in copies of the elements around it. Touches
 * the DOM as little as possible. A highlight or element that goes on into
 * the piece beside it, within the visible run `shown` (a grapheme kept with
 * an ellipsis is a piece of its own), says so to CSS with `data-fp-open`
 * ('start', 'end').
 */
export function fillPiece(el: HTMLElement, graphemes: readonly string[], marking: Marking, [from, to]: Range, shown: Range): void {
  const runs = plainIn(marking, from, to) ? null : stretches(graphemes, marking, from, to);
  if (!runs || runs.every((r) => r.cls === null && r.chain === null && !r.found)) {
    filled.delete(el);
    const text = marking.text.slice(marking.offsets[from], marking.offsets[to]);
    const node = el.firstChild;
    if (node instanceof Text && el.childNodes.length === 1) {
      if (node.data !== text) node.data = text;
    } else if (el.childNodes.length > 0 || text !== '') {
      el.textContent = text;
    }
    return;
  }
  const { classes, chains } = marking;
  const key = JSON.stringify([shown, runs.map((r) => [r.cls, chainId(r.chain), r.found, r.text])]);
  if (filled.get(el) === key) return;
  filled.set(el, key);
  // Whether what's at `[start, end)` goes on into the graphemes beside it.
  const open = (el: Element, start: number, end: number, same: (i: number) => boolean) => {
    const sides = [start > shown[0] && same(start - 1) ? 'start' : '', end < shown[1] && same(end) ? 'end' : ''].filter(Boolean);
    if (sides.length > 0) el.setAttribute('data-fp-open', sides.join(' '));
  };
  const placed = runs.map(({ cls, chain, found, start, end, text }): Placed => {
    if (cls === null && !found) return { chain, nodes: [document.createTextNode(text)], start, end };
    const span = document.createElement('span');
    span.textContent = text;
    if (found) span.setAttribute('data-fp-match', '');
    if (cls === null) return { chain, nodes: [span], start, end };
    span.className = cls;
    span.setAttribute('data-fp-kept', '');
    open(span, start, end, (i) => classes[i] === cls);
    return { chain, nodes: [span], start, end };
  });
  el.replaceChildren(
    ...nest(placed, false, (copy, original, start, end) => open(copy, start, end, (i) => !!chains[i]?.includes(original))),
  );
}
