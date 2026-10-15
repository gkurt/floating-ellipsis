/**
 * A join: an ellipsis with the grapheme either side of it, kept on one line,
 * and beside it what it hides, for find in page to find and for showing in
 * its place while expanded.
 */
import { type Range, wordAround } from './cut.ts';
import { type EllipsisStyle, buildMarks } from './marks.ts';

export interface Join {
  el: HTMLSpanElement;
  before: HTMLSpanElement;
  ellipsis: HTMLSpanElement;
  after: HTMLSpanElement;
  marks: HTMLSpanElement[];
  /**
   * What the ellipsis hides, before it: in the document while find in page
   * may look for it or while it shows (it costs every layout something).
   */
  found: HTMLSpanElement;
  /** What the ellipsis holds: its marks, glued in place. */
  drawn: Node[];
}

export const WORD_JOINER = '⁠';

/**
 * Make `parent`'s children exactly `want`, moving as little as possible:
 * ellipses that stay keep their place, so their animations and hover state
 * survive resizing.
 */
export function reconcile(parent: Element, want: readonly Node[]): void {
  want.forEach((node, i) => {
    const at = parent.childNodes[i];
    if (at !== node) parent.insertBefore(node, at ?? null);
  });
  while (parent.childNodes.length > want.length) parent.lastChild!.remove();
}

/** How what an ellipsis hides is hidden: from find in page too, or only until found. */
const hiding = (find: boolean) => (find ? 'until-found' : '');

/** Join `index` of instance `id`, its ellipsis drawn in `style`. */
export function createJoin(id: string, index: number, find: boolean): Join {
  const span = (attr: string) => {
    const el = document.createElement('span');
    el.setAttribute(attr, '');
    return el;
  };
  const el = span('data-fp-join');
  el.style.whiteSpace = 'nowrap';
  const ellipsis = span('data-fp-ellipsis');
  ellipsis.dataset.fpEllipsis = `${id}:${index}`;
  // Out of the flow, so it takes no room while hidden (and blockified,
  // which `hidden="until-found"` needs to hide it).
  const found = span('data-fp-found');
  found.dataset.fpFound = `${id}:${index}`;
  found.style.position = 'absolute';
  found.setAttribute('hidden', hiding(find));
  const join: Join = { el, before: span('data-fp-before'), ellipsis, after: span('data-fp-after'), marks: [], found, drawn: [] };
  el.append(join.before, ellipsis, join.after);
  place(join, find);
  return join;
}

/**
 * Draw the join's marks in `style`. WebKit breaks a line after the (inline-
 * block) marks despite the join's `nowrap`, unless text sits right before and
 * after them in the ellipsis: `glue` puts joiners there.
 */
export function drawMarks(join: Join, style: EllipsisStyle, glue: boolean): void {
  join.marks = buildMarks(style);
  const joiner = () => document.createTextNode(WORD_JOINER);
  join.drawn = glue && join.marks.length > 0 ? [joiner(), ...join.marks, joiner()] : join.marks;
  join.ellipsis.replaceChildren(...join.drawn);
}

/** Margins around the join's ellipsis, and before each of its marks after the first (`inner`). */
export function space(join: Join, left: number, right: number, inner: readonly number[]): void {
  const style = join.ellipsis.style;
  style.marginLeft = left !== 0 ? `${left}px` : '';
  style.marginRight = right !== 0 ? `${right}px` : '';
  join.marks.forEach((mark, i) => {
    if (i === 0) return;
    const before = inner[i - 1] ?? 0;
    mark.style.marginLeft = before !== 0 ? `${before}px` : '';
  });
}

/** Put what the join's ellipsis hides in the document, before the ellipsis, or take it out. */
function place(join: Join, present: boolean): void {
  if (present && !join.found.isConnected) join.ellipsis.before(join.found);
  else if (!present && join.found.isConnected) join.found.remove();
}

/** Show what the join's ellipsis hides in its place, or hide it again (`find`: from find in page only until found). */
export function showHidden(join: Join, shown: boolean, find: boolean): void {
  place(join, shown || find);
  if (shown) join.found.removeAttribute('hidden');
  else join.found.setAttribute('hidden', hiding(find));
  join.found.style.position = shown ? '' : 'absolute';
  join.el.style.whiteSpace = shown ? '' : 'nowrap';
  join.ellipsis.replaceChildren(...(shown ? [] : join.drawn));
  if (shown) join.ellipsis.style.margin = '';
}

/** Hide what the join's ellipsis hides from find in page, or only until it's found. */
export function setFindable(join: Join, find: boolean): void {
  if (join.found.getAttribute('hidden') !== hiding(find)) join.found.setAttribute('hidden', hiding(find));
  place(join, find || !join.found.hasAttribute('hidden'));
}

/**
 * What `fillWords` last put in each join: the range, and each node by the
 * piece it holds, so filling it again only touches what changed.
 */
const worded = new WeakMap<HTMLElement, { graphemes: readonly string[]; key: string; nodes: Map<string, Node> }>();

/**
 * Put graphemes `[from, to)` in what the join's ellipsis hides, for find in
 * page, each word (`words`: `wordsOf`) in an inline `hidden="until-found"`
 * span of its own, `data-fp-word` its whole range. Find in page fires
 * `beforematch` at the innermost of those a match starts in, which is how
 * the match is known. (Inline, they hide nothing themselves, and a match can
 * run on across them.) Pieces filled last time stay: a cut that moves by a
 * few graphemes changes a few words at its ends.
 */
export function fillWords(join: Join, graphemes: readonly string[], words: Int32Array, [from, to]: Range): void {
  const key = `${from}:${to}`;
  const seen = worded.get(join.found);
  // Pieces of other text are no use.
  const last = seen?.graphemes === graphemes ? seen : undefined;
  if (last?.key === key) return;
  const nodes = new Map<string, Node>();
  const want: Node[] = [];
  for (let i = from; i < to;) {
    // A word (or what's left of it), or the run of graphemes up to the next one.
    const word = words[i]! >= 0;
    let end = i + 1;
    if (word) end = Math.min(to, wordAround(words, i)[1]);
    else while (end < to && words[end]! < 0) end++;
    const piece = `${i}:${end}`;
    let node = last?.nodes.get(piece);
    if (!node) {
      const text = graphemes.slice(i, end).join('');
      if (word) {
        const span = document.createElement('span');
        span.setAttribute('hidden', 'until-found');
        span.dataset.fpWord = wordAround(words, i).join(':');
        span.textContent = text;
        node = span;
      } else {
        node = document.createTextNode(text);
      }
    }
    nodes.set(piece, node);
    want.push(node);
    i = end;
  }
  worded.set(join.found, { graphemes, key, nodes });
  // The pieces that stay are in order: drop the rest, and put new ones in around them.
  const staying = new Set(want);
  let child = join.found.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (!staying.has(child)) child.remove();
    child = next;
  }
  reconcile(join.found, want);
}

/** What the join's ellipsis hides was filled otherwise (or shown): `fillWords` must fill it afresh. */
export function forgetWords(join: Join): void {
  worded.delete(join.found);
}
