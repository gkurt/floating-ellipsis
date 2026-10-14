/**
 * `<elide-text>`: a custom element that truncates its own text, configured by
 * attributes, for any framework or none.
 */
import { Binding } from './bind.ts';
import { type Keep, type Position, type Snap, separators, words } from './cut.ts';
import type { Elide } from './elide.ts';
import type { Gap } from './metrics.ts';
import type { ElideChange, ElideOptions } from './options.ts';

const ATTRIBUTES = [
  'lines',
  'position',
  'keep',
  'ellipsis',
  'gap',
  'justify',
  'trim',
  'snap',
  'glyphs',
  'tooltip-title',
  'copy',
  'text',
] as const;

const isGap = (v: string): v is Extract<Gap, string> => v === 'dots' || v === 'natural' || v === 'none' || /^-?[\d.]+(em|px)$/.test(v);
const isJustify = (v: string): v is 'dots' | 'ellipsis' | 'spread' => v === 'dots' || v === 'ellipsis' || v === 'spread';

/** `'middle'`, `'0.3'`, or several: `'0.33 0.67'`. */
function parsePosition(value: string): Position | Position[] {
  const one = (v: string): Position => (v === 'start' || v === 'middle' || v === 'end' ? v : Number(v));
  const parts = value.trim().split(/[\s,]+/);
  return parts.length > 1 ? parts.map(one) : one(parts[0] ?? 'end');
}

/** A string, or `/pattern/flags`. */
function parseKeep(value: string): Keep {
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
 * Truncates its text to fit, like `elide(this, options)`. Attributes:
 * `lines`, `position` (`middle`, `0.3`, `0.33 0.67`), `keep` (a string or
 * `/regex/flags`), `ellipsis`, `gap`, `justify` (`false` to turn it off),
 * `trim` (`false`), `snap` (`words`, `paths`, or separator characters),
 * `glyphs`, `tooltip-title` (the `title` option), `copy` and `text` (else
 * its text content). The `options` property takes anything `elide` does and
 * wins over attributes. Fires `elidechange` with an `ElideChange` as `detail`.
 *
 * It's a block by default: its width must not depend on its content.
 */
export class ElideElement extends HTMLElement {
  static readonly observedAttributes: readonly string[] = ATTRIBUTES;

  private binding: Binding | null = null;
  private extra: ElideOptions = {};
  private initialText = '';
  /** The last `snap` attribute and what it made, so it isn't new on every change. */
  private snapped: [string, Snap | null] = ['', null];

  private readonly emit = (detail: ElideChange) => {
    this.dispatchEvent(new CustomEvent('elidechange', { detail }));
    this.extra.onChange?.(detail);
  };

  /** The live instance while connected. */
  get instance(): Elide | null {
    return this.binding?.instance ?? null;
  }

  /** Options on top of the attributes. */
  get options(): ElideOptions {
    return this.extra;
  }

  set options(options: ElideOptions) {
    this.extra = options;
    this.binding?.set(this.resolved());
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
    if (this.binding) return;
    if (getComputedStyle(this).display === 'inline') this.style.display = 'block';
    this.initialText = (this.textContent ?? '').replace(/\s+/g, ' ').trim();
    this.binding = new Binding(this, this.resolved());
  }

  disconnectedCallback(): void {
    this.binding?.destroy();
    this.binding = null;
  }

  attributeChangedCallback(): void {
    this.binding?.set(this.resolved());
  }

  private resolved(): ElideOptions {
    const attr = (name: (typeof ATTRIBUTES)[number]) => this.getAttribute(name);
    const flag = (name: (typeof ATTRIBUTES)[number]) => {
      const v = attr(name);
      return v === null ? undefined : v !== 'false';
    };
    const options: ElideOptions = {
      text: attr('text') ?? this.initialText,
      onChange: this.emit,
    };
    const lines = attr('lines');
    if (lines !== null) options.lines = Number(lines);
    const position = attr('position');
    if (position !== null) options.position = parsePosition(position);
    const keep = attr('keep');
    if (keep !== null) options.keep = parseKeep(keep);
    const ellipsis = attr('ellipsis');
    if (ellipsis !== null) options.ellipsis = ellipsis;
    const gap = attr('gap');
    if (gap !== null) options.gap = isGap(gap) ? gap : Number(gap);
    const justify = attr('justify');
    if (justify !== null) options.justify = isJustify(justify) ? justify : false;
    const snap = attr('snap');
    if (snap !== null) {
      if (this.snapped[0] !== snap) this.snapped = [snap, parseSnap(snap)];
      options.snap = this.snapped[1];
    }
    const copy = attr('copy');
    if (copy === 'full' || copy === 'visible') options.copy = copy;
    options.trim = flag('trim');
    options.glyphs = flag('glyphs');
    options.title = flag('tooltip-title');
    const { onChange: _, ...extra } = this.extra;
    return Object.fromEntries(Object.entries({ ...options, ...extra }).filter(([, v]) => v !== undefined));
  }
}

/** Register `<elide-text>` (or `name`). Safe to call more than once. */
export function define(name = 'elide-text'): void {
  if (!customElements.get(name)) customElements.define(name, ElideElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'elide-text': ElideElement;
  }
}
