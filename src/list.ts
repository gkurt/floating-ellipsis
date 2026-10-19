/**
 * Lists (`floating-ellipsis/list`): items cut whole from the end, and a label
 * for the ones hidden, as one more item: "Ada, Grace and 2 more".
 */
import type { Range, Snap } from './cut.ts';
import type { ElideOptions, Suffix, SuffixSlot } from './options.ts';

/** The items: strings, the text joined from them, or a function finding them in the text. */
export type Items = readonly string[] | ((text: string) => readonly string[]);

export interface ListOptions {
  /** What stands for the hidden items, given how many are hidden and how many there are. Default `${hidden} more`. */
  label?: (hidden: number, total: number) => string;
  /**
   * What goes between the last item showing and the label. Default: what
   * `format` puts before a last item, for an array; the text's last
   * separator, for a function.
   */
  joiner?: string;
  /** How an array of items is joined into the text. Default `new Intl.ListFormat()`: "and", in the page's language. */
  format?: Intl.ListFormat;
  /** What ends the first item when even it doesn't fit whole, before the label. Default '…'. */
  ellipsis?: string;
}

/** Fewest graphemes of the first item worth showing, when it's cut. */
const FRAGMENT = 3;

/** A `list()`'s items and options, which its snap and label share. */
interface Listing {
  items: Items;
  label: (hidden: number, total: number) => string;
  joiner: string | undefined;
  format: Intl.ListFormat | null;
  ellipsis: string;
}

/** Where a text's items are: grapheme ranges, in order, and the separator before the last. */
interface Located {
  ranges: Range[];
  last: string;
}

/**
 * Lay out a list: items show whole or not at all, from the start, and a
 * label for the hidden ones follows the last that shows. When even the first
 * doesn't fit, it's cut, and the label starts with an ellipsis: "Ada Lovel…
 * and 3 more". Items are strings, joined into the text by `format`, or a
 * function that finds them in the text, in order (`split(', ')`).
 *
 * Spread what it returns into the options, before any of your own:
 * `elide(el, { ...list(names), lines: 2 })`. It sets `snap`, `suffix`,
 * `position`, `ellipsis`, `gap`, `justify`, `repeat` and `find` (and `text`,
 * for an array), so leave those as they are.
 */
export function list(items: Items, options: ListOptions = {}): ElideOptions {
  const { label = (hidden: number) => `${hidden} more`, joiner, ellipsis = '…' } = options;
  const format = typeof items === 'function' ? null : (options.format ?? new Intl.ListFormat());
  const text = format && typeof items !== 'function' ? format.format(items) : null;
  const listing: Listing = { items, label, joiner, format, ellipsis };
  const snap: Snap = ({ graphemes, start, end }) => {
    const { ranges } = locate(listing, graphemes);
    // Cut elsewhere than at the end (another position): left as it is.
    if (end < graphemes.length) return { start, end };
    let at = -1;
    for (const [, e] of ranges) {
      if (e > start) break;
      at = e;
    }
    if (at >= 0) return { start: at, end };
    // No item fits whole: the first is cut, and the label ends it, unless that leaves a sliver of it.
    return { start: start - (ranges[0]?.[0] ?? 0) < FRAGMENT ? 0 : start, end };
  };
  return {
    ...(text !== null && { text }),
    snap,
    suffix: LABEL_SUFFIX,
    position: 'end',
    ellipsis: '',
    gap: 'none',
    justify: false,
    repeat: false,
    find: 'expand',
  };
}

/**
 * Items between separators, for `list`: a string (as it is, all of it) or a
 * RegExp (every match). White space around items is left out, and so are
 * empty ones.
 */
export function split(separator: string | RegExp): (text: string) => string[] {
  return (text) => {
    const items: string[] = [];
    let at = 0;
    const take = (to: number, next: number) => {
      const item = text.slice(at, to).trim();
      if (item) items.push(item);
      at = next;
    };
    if (typeof separator === 'string') {
      for (let i = separator ? text.indexOf(separator) : -1; i >= 0; i = text.indexOf(separator, at)) take(i, i + separator.length);
    } else {
      const re = new RegExp(separator.source, separator.flags.includes('g') ? separator.flags : `${separator.flags}g`);
      for (const m of text.matchAll(re)) if (m[0]) take(m.index, m.index + m[0].length);
    }
    take(text.length, text.length);
    return items;
  };
}

/** Each instance's graphemes as items, and the listing that last cut them: the label reads what the snap found. */
const located = new WeakMap<readonly string[], { listing: Listing; located: Located }>();

/** Where `listing`'s items are in `graphemes`. */
function locate(listing: Listing, graphemes: readonly string[]): Located {
  const known = located.get(graphemes);
  if (known?.listing === listing) return known.located;
  const text = graphemes.join('');
  const names = typeof listing.items === 'function' ? listing.items(text) : listing.items;
  // The first grapheme starting at or after each offset asked for, in order.
  let g = 0;
  let offset = 0;
  const index = (to: number) => {
    while (g < graphemes.length && offset < to) offset += graphemes[g++]!.length;
    return g;
  };
  const ranges: Range[] = [];
  const offsets: Range[] = [];
  let at = 0;
  for (const name of names) {
    if (!name) continue;
    const start = text.indexOf(name, at);
    if (start < 0) throw new Error(`floating-ellipsis/list: "${name}" isn't in the text after the items before it`);
    at = start + name.length;
    offsets.push([start, at]);
    ranges.push([index(start), index(at)]);
  }
  const [before, last] = offsets.slice(-2);
  const result = { ranges, last: before && last ? text.slice(before[1], last[0]) : ' ' };
  located.set(graphemes, { listing, located: result });
  return result;
}

/** The label for `graphemes` cut where `hidden` says: '' while nothing is. */
function labelOf(listing: Listing, { ranges, last }: Located, hidden: readonly Range[], graphemes: readonly string[]): string {
  const total = ranges.length;
  const cut = hidden[0]?.[0];
  if (cut === undefined || total === 0) return '';
  if (cut === 0) return listing.label(total, total);
  const textOf = ([s, e]: Range) => graphemes.slice(s, e).join('');
  let whole = 0;
  while (whole < total && ranges[whole]![1] <= cut) whole++;
  const next = ranges[whole];
  // Cut inside an item, which shows in part, or before the first (in text that leads the list).
  const inside = next !== undefined && cut > next[0];
  const part = inside || whole === 0;
  const showing = ranges.slice(0, whole).map(textOf);
  if (part) showing.push(inside ? textOf([next[0], cut]) : '');
  const others = ranges.filter(([s, e]) => hidden.some(([a, b]) => a < e && b > s)).length - (inside ? 1 : 0);
  const end = part ? listing.ellipsis : '';
  if (others === 0) return end;
  const label = listing.label(others, total);
  return end + joinerOf(listing, last, showing, label) + label;
}

/** What goes between the items showing and `label`. */
function joinerOf(listing: Listing, last: string, showing: string[], label: string): string {
  if (listing.joiner !== undefined) return listing.joiner;
  if (!listing.format) return last;
  const parts = listing.format.formatToParts([...showing, label]);
  const at = parts.findLastIndex((p) => p.type === 'element');
  return parts[at - 1]?.type === 'literal' ? parts[at - 1]!.value : ' ';
}

const LABEL = 'data-fp-list';
/** Keeps the label on the line of what comes before it. */
const WORD_JOINER = '⁠';

/**
 * The label is generated content where it can be: find in page doesn't find
 * it and copying leaves it out, since the hidden items are there in full.
 * Expanded, the items show, so it doesn't.
 */
let sheet: CSSStyleSheet | null | undefined;
const adopted = new WeakSet<Document | ShadowRoot>();

/** Whether the label can be generated content where `node` is, adopting the rules that draw it. */
function canDraw(node: Node): boolean {
  if (sheet === undefined) {
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(`[${LABEL}]::after{content:attr(${LABEL})}[data-fp-expanded]>[${LABEL}]{display:none}`);
    } catch {
      sheet = null;
    }
  }
  const root = node.getRootNode();
  if (!sheet || !(root instanceof Document || root instanceof ShadowRoot)) return false;
  if (!adopted.has(root)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    adopted.add(root);
  }
  return true;
}

/** The label, after the line: a suffix whose text follows the cut. */
class Label implements SuffixSlot {
  readonly el: HTMLSpanElement = document.createElement('span');
  readonly #host: HTMLElement;
  #text = '';

  constructor(host: HTMLElement) {
    this.#host = host;
    this.el.setAttribute(LABEL, '');
    // Screen readers read every item from the full text.
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.whiteSpace = 'nowrap';
  }

  fill(): void {
    this.el.replaceChildren(WORD_JOINER);
    this.#host.append(this.el);
  }

  measure(): number {
    return this.el.getBoundingClientRect().width;
  }

  show(on: boolean, hidden: readonly Range[], graphemes: readonly string[]): void {
    const known = located.get(graphemes);
    const text = on && known ? labelOf(known.listing, known.located, hidden, graphemes) : '';
    this.el.style.display = text ? '' : 'none';
    if (text === this.#text) return;
    this.#text = text;
    const drawn = canDraw(this.el);
    this.el.setAttribute(LABEL, drawn ? text : '');
    this.el.replaceChildren(WORD_JOINER, ...(drawn ? [] : [text]));
  }

  giveBack(): void {}
}

const LABEL_SUFFIX: Suffix = { content: ' ', show: 'truncated', place: (host) => new Label(host) };
