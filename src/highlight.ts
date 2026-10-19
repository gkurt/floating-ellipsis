/**
 * The pieces of a line (a visible run, the grapheme kept beside an ellipsis,
 * or the text an ellipsis hides) with highlights and markup in them: classes
 * from `keep` wrap stretches of a piece's text in spans, and copies of the
 * text's own elements go around those. Finding a grapheme in a piece goes
 * through these.
 */
import type { Range } from './cut.ts';
import { type Chain, type Placed, SHORT, nest, unitCopy } from './markup.ts';
import type { ShortPart } from './shorten.ts';

/** How each grapheme is marked up: the classes `keep` gives it, the elements around it, and what find in page found. */
export interface Marking {
  classes: readonly (string | null)[];
  /** Empty when the text has no elements. */
  chains: readonly (Chain | null)[];
  /** The unit (an image, an icon) each grapheme is, or null; empty when there are none. */
  units: readonly (Element | null)[];
  /** What find in page found, kept in sight (see `find`). */
  match: Range | null;
  /** No grapheme has a class or an element around it, or is a unit. */
  plain: boolean;
  /** The whole text, and where each grapheme starts in it (length n + 1). */
  text: string;
  offsets: readonly number[];
  /** The parts showing in a short form, in order (see `shorten`); empty for none. */
  short: readonly ShortPart[];
  /** The element a part of `short` shows as (see `shortCopy`). */
  shortEl: (part: ShortPart) => Element;
}

/** Whether graphemes `[from, to)` are plain text, with nothing to wrap them in. */
const plainIn = ({ plain, match, short }: Marking, from: number, to: number) =>
  plain && (!match || match[1] <= from || match[0] >= to) && !short.some((p) => p.start < to && p.end > from);

/** The part of `short` grapheme `i` is in, or null. */
export const shortOf = (short: readonly ShortPart[], i: number): ShortPart | null => short.find((p) => i >= p.start && i < p.end) ?? null;

/** Marks a short form's element in the line with the instance and the graphemes it stands for: `id:start:end`. */
export const FORM = 'data-fp-form';

/**
 * The element `part` shows as in the line of instance `id`: its short form,
 * kept on one line, and its long form where find in page (`find`) can find
 * it, hidden until found. The short form is generated content where it can
 * be (`drawn`), so find in page doesn't find it, nor a search for it count
 * twice, the second time in the long form.
 */
export function shortCopy(part: ShortPart, id: string, find: boolean, drawn: boolean): HTMLSpanElement {
  const el = document.createElement('span');
  el.setAttribute(FORM, `${id}:${part.start}:${part.end}`);
  el.setAttribute(SHORT, drawn ? part.form : '');
  el.style.whiteSpace = 'nowrap';
  if (!drawn) el.append(part.form);
  if (!find) return el;
  const found = document.createElement('span');
  found.dataset.fpFound = `${id}:s${part.start}`;
  // Out of the flow and blockified, as an ellipsis' hidden text is (see `createJoin`).
  found.style.position = 'absolute';
  found.setAttribute('hidden', 'until-found');
  found.textContent = part.text;
  el.append(found);
  return el;
}

/**
 * Graphemes `[from, to)` as stretches that share their class, elements and
 * being found. A unit is a stretch of its own.
 */
function stretches(graphemes: readonly string[], { classes, chains, units, match, short }: Marking, from: number, to: number) {
  const out: {
    cls: string | null;
    chain: Chain | null;
    unit: Element | null;
    short: ShortPart | null;
    found: boolean;
    start: number;
    end: number;
    text: string;
  }[] = [];
  for (let i = from; i < to; i++) {
    const cls = classes[i] ?? null;
    const chain = chains[i] ?? null;
    const unit = units[i] ?? null;
    const found = !!match && i >= match[0] && i < match[1];
    const part = short.length > 0 ? shortOf(short, i) : null;
    if (part) {
      // A short form is a stretch of its own, all of its part.
      const end = Math.min(to, part.end);
      out.push({ cls, chain, unit: null, short: part, found, start: i, end, text: graphemes.slice(i, end).join('') });
      i = end - 1;
      continue;
    }
    const last = out.at(-1);
    if (last && !unit && !last.unit && !last.short && last.cls === cls && last.chain === chain && last.found === found) {
      last.end = i + 1;
      last.text += graphemes[i]!;
    } else {
      out.push({ cls, chain, unit, short: null, found, start: i, end: i + 1, text: graphemes[i]! });
    }
  }
  return out;
}

const chainIds = new WeakMap<object, number>();
let nextChain = 1;
/** A number for `chain` (or a unit), the same for as long as it lives; 0 for null. */
export const chainId = (chain: Chain | Element | null): number => {
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
  const { classes, chains, match, short } = marking;
  // A part in a short form goes with the ellipsis whole.
  const part = shortOf(short, edge);
  if (part) return edge === a ? Math.min(b, part.end) - a : b - Math.max(a, part.start);
  const words = wordsOf();
  const mark = (i: number) =>
    `${classes[i] ?? ''}|${chainId(chains[i] ?? null)}|${!!match && i >= match[0] && i < match[1]}|${shortOf(short, i)?.start ?? ''}`;
  const own = mark(edge);
  if (own === '|0|false|') return 1;
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
  if (!runs || runs.every((r) => r.cls === null && r.chain === null && r.unit === null && r.short === null && !r.found)) {
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
  const key = JSON.stringify([shown, runs.map((r) => [r.cls, chainId(r.chain), chainId(r.unit), r.short?.form ?? null, r.found, r.text])]);
  if (filled.get(el) === key) return;
  filled.set(el, key);
  // Whether what's at `[start, end)` goes on into the graphemes beside it.
  const open = (el: Element, start: number, end: number, same: (i: number) => boolean) => {
    const sides = [start > shown[0] && same(start - 1) ? 'start' : '', end < shown[1] && same(end) ? 'end' : ''].filter(Boolean);
    if (sides.length > 0) el.setAttribute('data-fp-open', sides.join(' '));
  };
  const placed = runs.map(({ cls, chain, unit, short, found, start, end, text }): Placed => {
    const content = short ? marking.shortEl(short) : unit ? unitCopy(unit, start) : document.createTextNode(text);
    if (cls === null && !found) return { chain, nodes: [content], start, end };
    const span = document.createElement('span');
    span.append(content);
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
