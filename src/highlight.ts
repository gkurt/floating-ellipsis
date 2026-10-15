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
}

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
const chainId = (chain: Chain | null) => {
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
  { classes, chains, match }: Marking,
  graphemes: readonly string[],
  words: Int32Array,
  [a, b]: Range,
  edge: number,
  wraps: boolean,
): number {
  if (a >= b) return 0;
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
const filled = new WeakMap<HTMLElement, string>();

/**
 * Make `el` hold graphemes `[from, to)`: plain text, or text in spans for
 * stretches with a class and in copies of the elements around it. Touches
 * the DOM as little as possible. A highlight or element that goes on into
 * the piece beside it, within the visible run `shown` (a grapheme kept with
 * an ellipsis is a piece of its own), says so to CSS with `data-fp-open`
 * ('start', 'end').
 */
export function fillPiece(el: HTMLElement, graphemes: readonly string[], marking: Marking, [from, to]: Range, shown: Range): void {
  const runs = stretches(graphemes, marking, from, to);
  if (runs.every((r) => r.cls === null && r.chain === null && !r.found)) {
    filled.delete(el);
    const text = runs.map((r) => r.text).join('');
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

/** Glyph mode: put the glyph elements of `[from, to)` in `el`, inside copies of their elements. */
export function fillGlyphs(el: HTMLElement, glyphs: readonly HTMLElement[], chains: readonly (Chain | null)[], [from, to]: Range): void {
  const want = glyphs.slice(from, to);
  if (chains.length === 0) {
    const have = el.childNodes;
    if (have.length !== want.length || want.some((g, i) => have[i] !== g)) el.replaceChildren(...want);
    return;
  }
  const key = `${from}:${chains.slice(from, to).map(chainId).join(',')}`;
  if (filled.get(el) === key && want.every((g) => el.contains(g))) return;
  filled.set(el, key);
  const placed: Placed[] = [];
  for (let i = from; i < to; i++) {
    const chain = chains[i] ?? null;
    const last = placed.at(-1);
    if (last && last.chain === chain) {
      last.nodes.push(glyphs[i]!);
      last.end = i + 1;
    } else {
      placed.push({ chain, nodes: [glyphs[i]!], start: i, end: i + 1 });
    }
  }
  el.replaceChildren(...nest(placed, false));
}

/** Give the glyph elements of graphemes in `ranges` `attribute`, and take it from the rest. */
export function markGlyphs(glyphs: readonly HTMLElement[], attribute: string, ranges: readonly Range[]): void {
  glyphs.forEach((el, i) =>
    el.toggleAttribute(
      attribute,
      ranges.some(([s, e]) => i >= s && i < e),
    ),
  );
}

/** The text node holding code unit `at` of a piece's text, and the offset in it. */
export function textAt(el: HTMLElement, at: number): [Text, number] | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    if (at < node.data.length) return [node, at];
    at -= node.data.length;
  }
  return null;
}

/**
 * The graphemes each node in a piece holding `[from, to)` spells: every
 * element and text node in it. `offsets[i]` is where grapheme `i` starts.
 */
export function childRanges(el: HTMLElement, [from, to]: Range, offsets: readonly number[]): [Node, Range][] {
  const out: [Node, Range][] = [];
  let i = from;
  const visit = (node: Node) => {
    const start = i;
    if (node instanceof Text) {
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
