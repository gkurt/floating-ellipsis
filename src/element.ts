/**
 * `<elide-text>`: a custom element that truncates its own text, configured by
 * attributes, for any framework or none.
 */
import { autoSize } from './autosize.ts';
import { type BindingOptions, Binding } from './bind.ts';
import type { ElideChange } from './changes.ts';
import { type Position, type Snap, separators, words } from './cut.ts';
import type { Elide } from './elide.ts';
import { glyphs } from './glyphs.ts';
import type { Length } from './marks.ts';
import type { Gap } from './metrics.ts';
import { suffix } from './suffix.ts';

const ATTRIBUTES = [
  'lines',
  'position',
  'keep',
  'keep-class',
  'ellipsis',
  'gap',
  'max-gap',
  'justify',
  'trim',
  'snap',
  'glyphs',
  'tooltip-title',
  'copy',
  'show-suffix',
  'find',
  'auto-size',
  'text',
] as const;

// A stand-in on servers, so importing this module there doesn't throw.
const Base = typeof HTMLElement === 'undefined' ? (class {} as typeof HTMLElement) : HTMLElement;

const isLength = (v: string): v is Exclude<Length, number> => /^-?[\d.]+(em|px)$/.test(v);
const isGap = (v: string): v is Extract<Gap, string> => v === 'dots' || v === 'natural' || v === 'none' || isLength(v);
const isJustify = (v: string): v is 'dots' | 'ellipsis' | 'spread' => v === 'dots' || v === 'ellipsis' || v === 'spread';

/** `'middle'`, `'0.3'`, or several: `'0.33 0.67'`. */
function parsePosition(value: string): Position | Position[] {
  const one = (v: string): Position => (v === 'start' || v === 'middle' || v === 'end' ? v : Number(v));
  const parts = value.trim().split(/[\s,]+/);
  return parts.length > 1 ? parts.map(one) : one(parts[0] ?? 'end');
}

/** A string, or `/pattern/flags`. */
function parseKeep(value: string): string | RegExp {
  const re = /^\/(.+)\/([a-z]*)$/.exec(value);
  return re ? new RegExp(re[1]!, re[2]) : value;
}

/** `'words'`, `'paths'`, or the separator characters themselves. */
function parseSnap(value: string): Snap | null {
  if (value === '') return null;
  if (value === 'words') return words();
  if (value === 'paths') return separators('/\\');
  return separators(value);
}

/**
 * Truncates its content to fit, like `elide(this, options)`: its text, with
 * inline elements (links, code, emphasis) kept. A child with
 * `slot="suffix"` is the `suffix`. Attributes: `lines`, `position`
 * (`middle`, `0.3`, `0.33 0.67`), `keep` (a string or `/regex/flags`) and
 * `keep-class` (a class to highlight it with), `ellipsis`, `gap`, `max-gap`
 * (`none` for no limit), `justify` (`false` to turn it off), `trim`
 * (`false`), `snap` (`words`, `paths`, or separator characters), `glyphs`,
 * `tooltip-title` (the `title` option), `copy`, `show-suffix`, `find`
 * (`keep`, `expand` or `false`), `auto-size` and `text` (else its content). The `options` property takes
 * anything `elide` does and wins over attributes. Fires `elidechange` with an
 * `ElideChange` as `detail`.
 *
 * It's a block by default. Displayed otherwise, with a width that comes
 * from its content (an inline-block, a flex item), it needs `auto-size`.
 */
export class ElideElement extends Base {
  static readonly observedAttributes: readonly string[] = ATTRIBUTES;

  #binding: Binding | null = null;
  #extra: BindingOptions = {};
  /** A copy of its content as first connected, without the suffix. */
  #initial: Node = document.createDocumentFragment();
  #suffix: Element | null = null;
  /** The last `snap` attribute and what it made, so it isn't new on every change. */
  #snapped: [string, Snap | null] = ['', null];

  readonly #emit = (detail: ElideChange) => {
    this.dispatchEvent(new CustomEvent('elidechange', { detail }));
    this.#extra.onChange?.(detail);
  };

  /** The live instance while connected. */
  get instance(): Elide | null {
    return this.#binding?.instance ?? null;
  }

  /** Options on top of the attributes. */
  get options(): BindingOptions {
    return this.#extra;
  }

  set options(options: BindingOptions) {
    this.#extra = options;
    this.#binding?.set(this.#resolved());
  }

  /** The full text, truncated or not. */
  get text(): string {
    return this.instance?.state.text ?? this.getAttribute('text') ?? this.textContent ?? '';
  }

  set text(text: string) {
    this.setAttribute('text', text);
  }

  connectedCallback(): void {
    // Parsed from HTML, the element is connected before its text is.
    if (document.readyState === 'loading' && !this.hasChildNodes()) {
      document.addEventListener('DOMContentLoaded', () => this.isConnected && this.connectedCallback(), { once: true });
      return;
    }
    if (this.#binding) return;
    if (getComputedStyle(this).display === 'inline') this.style.display = 'block';
    this.#suffix = this.querySelector(':scope > [slot="suffix"]');
    const content = document.createDocumentFragment();
    for (const node of this.childNodes) if (node !== this.#suffix) content.append(node.cloneNode(true));
    this.#initial = content;
    this.#binding = new Binding(this, this.#resolved());
  }

  disconnectedCallback(): void {
    this.#binding?.destroy();
    this.#binding = null;
  }

  attributeChangedCallback(): void {
    this.#binding?.set(this.#resolved());
  }

  #resolved(): BindingOptions {
    const attr = (name: (typeof ATTRIBUTES)[number]) => this.getAttribute(name);
    const flag = (name: (typeof ATTRIBUTES)[number]) => {
      const v = attr(name);
      return v === null ? undefined : v !== 'false';
    };
    const options: BindingOptions = {
      text: attr('text') ?? this.#initial,
      onChange: this.#emit,
    };
    if (this.#suffix) options.suffix = suffix(this.#suffix, { show: attr('show-suffix') === 'truncated' ? 'truncated' : 'always' });
    const find = attr('find');
    if (find === 'keep' || find === 'expand') options.find = find;
    else if (find === 'false') options.find = false;
    const lines = attr('lines');
    if (lines !== null) options.lines = Number(lines);
    const position = attr('position');
    if (position !== null) options.position = parsePosition(position);
    const keep = attr('keep');
    const keepClass = attr('keep-class');
    if (keep !== null) options.keep = keepClass ? { match: parseKeep(keep), class: keepClass } : parseKeep(keep);
    const ellipsis = attr('ellipsis');
    if (ellipsis !== null) options.ellipsis = ellipsis;
    const gap = attr('gap');
    if (gap !== null) options.gap = isGap(gap) ? gap : Number(gap);
    const maxGap = attr('max-gap');
    if (maxGap !== null) options.maxGap = maxGap === 'none' ? null : isLength(maxGap) ? maxGap : Number(maxGap);
    const justify = attr('justify');
    if (justify !== null) options.justify = isJustify(justify) ? justify : false;
    const snap = attr('snap');
    if (snap !== null) {
      if (this.#snapped[0] !== snap) this.#snapped = [snap, parseSnap(snap)];
      options.snap = this.#snapped[1];
    }
    const copy = attr('copy');
    if (copy === 'full' || copy === 'visible') options.copy = copy;
    options.trim = flag('trim');
    const glyphMode = flag('glyphs');
    if (glyphMode !== undefined) options.glyphs = glyphMode ? glyphs : null;
    options.title = flag('tooltip-title');
    const sized = flag('auto-size');
    if (sized !== undefined) options.autoSize = sized ? autoSize() : null;
    const { onChange: _, ...extra } = this.#extra;
    return Object.fromEntries(Object.entries({ ...options, ...extra }).filter(([, v]) => v !== undefined));
  }
}

/** Register `<elide-text>` (or `name`). Safe to call more than once, and on a server (where it does nothing). */
export function define(name = 'elide-text'): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(name)) customElements.define(name, ElideElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'elide-text': ElideElement;
  }
}
