/**
 * Inline markup: text read from DOM nodes with the elements around it kept
 * (links, code, emphasis), copied around whatever part of it shows, and the
 * screen-reader copy of it all.
 */

/** The elements around a stretch of text, outermost first. */
export type Chain = readonly Element[];

/** Elements whose text isn't text to show. */
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/**
 * The text of `nodes` with whitespace collapsed and trimmed, and the chain
 * of elements around each of its code units (null outside any, and null for
 * all of it when there are none). `skip` and what's inside it are left out.
 * Images, SVG and other elements without text add nothing; `<br>` is a space.
 */
export function readMarkup(nodes: Iterable<Node>, skip: Node | null = null): { text: string; chains: (Chain | null)[] | null } {
  let text = '';
  const chains: (Chain | null)[] = [];
  let marked = false;
  // The chain of a run of whitespace waiting to become one space.
  let gap: Chain | null | undefined;
  const add = (data: string, chain: Chain | null) => {
    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      if (/\s/.test(c)) {
        if (gap === undefined) gap = chain;
        continue;
      }
      if (gap !== undefined && text !== '') {
        text += ' ';
        chains.push(gap);
      }
      gap = undefined;
      text += c;
      chains.push(chain);
    }
  };
  const walk = (node: Node, chain: Chain | null) => {
    if (node === skip) return;
    if (node instanceof Text) {
      add(node.data, chain);
      return;
    }
    if (node instanceof Element) {
      if (!(node instanceof HTMLElement) || SKIP.has(node.tagName)) return;
      if (node.tagName === 'BR') {
        add(' ', chain);
        return;
      }
      const inner = [...(chain ?? []), node];
      for (const child of node.childNodes) walk(child, inner);
      marked = true;
      return;
    }
    for (const child of node.childNodes) walk(child, chain);
  };
  for (const node of nodes) walk(node, null);
  return { text, chains: marked ? chains : null };
}

/** What a copy shown in the line can be focused by: the screen-reader copy takes focus instead. */
const FOCUSABLE = 'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]';

/** The element each copy was made from. */
export const originals = new WeakMap<Element, Element>();

/**
 * A shallow copy of `el`, without its id. A copy shown in the line
 * (`focusable` false) is out of the tab order: the screen-reader copy is in it.
 */
export function copyOf(el: Element, focusable: boolean): Element {
  const copy = el.cloneNode(false);
  if (!(copy instanceof Element)) return el;
  copy.removeAttribute('id');
  if (!focusable && copy.matches(FOCUSABLE)) copy.setAttribute('tabindex', '-1');
  originals.set(copy, originals.get(el) ?? el);
  return copy;
}

/**
 * Mark the copies of `original` under `root` with `attribute`, and unmark the
 * rest. Returns the ones marked.
 */
export function markCopies(root: Element, original: Element | null, attribute: string): Element[] {
  const marked: Element[] = [];
  for (const el of root.querySelectorAll('*')) {
    const is = original !== null && originals.get(el) === original;
    el.toggleAttribute(attribute, is);
    if (is) marked.push(el);
  }
  return marked;
}

/** The graphemes inside `original`, one of the elements in `chains` (by grapheme). */
export function extentOf(chains: readonly (Chain | null)[], original: Element): [number, number] | null {
  const inside = (c: Chain | null) => !!c?.includes(original);
  const start = chains.findIndex(inside);
  return start < 0 ? null : [start, chains.findLastIndex(inside) + 1];
}

/** Stretches of content, each inside the elements of its chain. */
export interface Placed {
  chain: Chain | null;
  nodes: Node[];
  /** The graphemes it holds. */
  start: number;
  end: number;
}

/**
 * The stretches as nodes, inside copies of their elements, nested as in the
 * original: stretches that share an element share its copy. Calls `opened`
 * with each copy and the graphemes it holds.
 */
export function nest(
  placed: readonly Placed[],
  focusable: boolean,
  opened?: (copy: Element, original: Element, start: number, end: number) => void,
): Node[] {
  const top: Node[] = [];
  const open: { original: Element; copy: Element; start: number; end: number }[] = [];
  const done: typeof open = [];
  const place = (node: Node) => {
    const parent = open.at(-1);
    if (parent) parent.copy.append(node);
    else top.push(node);
  };
  for (const { chain, nodes, start, end } of placed) {
    const c = chain ?? [];
    let k = 0;
    while (k < open.length && k < c.length && open[k]!.original === c[k]) k++;
    done.push(...open.splice(k));
    for (let d = k; d < c.length; d++) {
      const copy = copyOf(c[d]!, focusable);
      place(copy);
      open.push({ original: c[d]!, copy, start, end });
    }
    for (const o of open) o.end = end;
    for (const node of nodes) place(node);
  }
  done.push(...open);
  if (opened) for (const o of done) opened(o.copy, o.original, o.start, o.end);
  return top;
}

const SAY = 'data-fp-say';
let sheet: CSSStyleSheet | null | undefined;
const adopted = new WeakSet<Document | ShadowRoot>();

/**
 * Whether the screen-reader copy can be generated content where `node` is,
 * adopting the rule that draws it into its document or shadow root.
 */
function canSay(node: Node): boolean {
  if (sheet === undefined) {
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(`[${SAY}]::before{content:attr(${SAY})}`);
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

/**
 * Fill the screen-reader copy, `el`, in `host`, with the full text, its
 * elements kept. Its text is generated content where it can be (screen
 * readers read it, but find in page doesn't find it, which would otherwise
 * count every match twice, the first in text nobody sees). Returns whether it is.
 */
export function speak(el: HTMLElement, host: Node, graphemes: readonly string[], chains: readonly (Chain | null)[]): boolean {
  const saying = canSay(host);
  const text = (s: string): Node => {
    if (!saying) return document.createTextNode(s);
    const span = document.createElement('span');
    span.setAttribute(SAY, s);
    return span;
  };
  const placed: Placed[] = [];
  graphemes.forEach((g, i) => {
    const chain = chains[i] ?? null;
    const last = placed.at(-1);
    if (last && last.chain === chain) {
      last.end = i + 1;
      return;
    }
    placed.push({ chain, nodes: [], start: i, end: i + 1 });
  });
  for (const p of placed) p.nodes.push(text(graphemes.slice(p.start, p.end).join('')));
  el.replaceChildren(...nest(placed, true));
  return saying;
}
