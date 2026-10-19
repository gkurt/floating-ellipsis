/**
 * Inputs (`floating-ellipsis/input`): a text field shows its value cut to fit
 * while it isn't being edited, and all of it once it is, with the caret
 * where it was pressed and the glyph under the pointer staying put.
 */
import { type Elide, elide } from './elide.ts';
import { ellipsisAt, ellipsisRect, graphemeRect } from './geometry.ts';
import { graphemes } from './graphemes.ts';
import { inside } from './inside.ts';
import { applyTextTransform, fontOf, measure } from './metrics.ts';
import type { ElideOptions } from './options.ts';

/** `elide`'s options that make sense for a field's one line. */
export type InputOptions = Omit<ElideOptions, 'text' | 'lines' | 'find' | 'suffix' | 'autoSize' | 'glyphs' | 'title' | 'copy'>;

/** A field whose value shows cut while it isn't being edited. */
export interface ElidedInput {
  /** The instance cutting the value (or the placeholder) for show. */
  readonly instance: Elide;
  update(options: InputOptions): void;
  /** Read the field's style and value again, after a change nothing reports: a class that changes its font, say. */
  refresh(): void;
  /** Show the field as it was. */
  destroy(): void;
}

const FIELD = 'data-fp-input';
/** What hides the field's own text: not its colour, which its caret and the copy take. */
const FILL = '-webkit-text-fill-color';

/** Where CSS anchor positioning works, the copy follows the field wherever it goes. */
const ANCHORED = typeof CSS !== 'undefined' && CSS.supports('anchor-name', '--a');

/** The copy: over the field's text, unseen by pointers, screen readers and find in page. */
const OVERLAY =
  'position:absolute;box-sizing:border-box;margin:0;border-style:solid;border-color:transparent;background:none;' +
  'pointer-events:none;overflow:hidden;white-space:pre;direction:ltr;z-index:auto';

/** Typography the copy takes from the field, so its glyphs land on the field's. */
const TYPESET = [
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-stretch',
  'font-variant',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
  'letter-spacing',
  'word-spacing',
  'text-transform',
  'text-align',
  'text-rendering',
] as const;

/**
 * The field's native placeholder gives way to the copy's, which is cut the
 * same way. Its colour stays readable: only the fill goes.
 */
let sheet: CSSStyleSheet | null | undefined;
const adopted = new WeakSet<Document | ShadowRoot>();

function adopt(node: Node) {
  if (sheet === undefined) {
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(`[${FIELD}]::placeholder{${FILL}:transparent!important}`);
    } catch {
      sheet = null;
    }
  }
  const root = node.getRootNode();
  if (!sheet || !(root instanceof Document || root instanceof ShadowRoot) || adopted.has(root)) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  adopted.add(root);
}

let nextId = 1;

/** A length in px, or 0 for one that isn't (`normal`, say). */
function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Show `input`'s value cut to fit, as `elide` would cut it, while it isn't
 * being edited, and its placeholder cut while it's empty. Pressing the
 * field shows the whole value under the pointer where the cut one was: the
 * caret lands on the glyph pressed (or beside what a pressed ellipsis hides)
 * and dragging selects as usual. The value, the field and what's submitted
 * stay as they are; a copy of the cut text lies over the field's own, which
 * is hidden while the copy shows.
 *
 * ```js
 * elideInput(document.querySelector('input[name=path]'), { position: 'middle', keep: /[^/]+$/ });
 * ```
 */
export function elideInput(input: HTMLInputElement, options: InputOptions = {}): ElidedInput {
  return new Field(input, options);
}

class Field implements ElidedInput {
  readonly instance: Elide;
  readonly #input: HTMLInputElement;
  readonly #overlay: HTMLDivElement = document.createElement('div');
  readonly #anchor = `--fp-input-${nextId++}`;
  readonly #observer: ResizeObserver | null;
  readonly #mutations: MutationObserver;
  readonly #undo: (() => void)[] = [];
  /** A touch pressed this caret offset: placed once the field has focus. */
  #touched: number | null = null;
  /** The field couldn't scroll a pressed caret under the pointer: placed once the press ends, unless it dragged. */
  #unplaced: number | null = null;
  /** The field's own inline text fill, and its priority. */
  #own: [string, string] = ['', ''];
  #destroyed = false;

  constructor(input: HTMLInputElement, options: InputOptions) {
    this.#input = input;
    const overlay = this.#overlay;
    overlay.setAttribute('data-fp-input-copy', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    overlay.style.cssText = OVERLAY;
    input.after(overlay);
    input.setAttribute(FIELD, '');
    const own: [string, string] = [input.style.getPropertyValue(FILL), input.style.getPropertyPriority(FILL)];
    this.#own = own;
    this.#undo.push(() => input.style.setProperty(FILL, ...own));
    adopt(input);
    this.instance = elide(overlay, { ...options, text: '', find: false });
    this.#restyle();
    if (ANCHORED) {
      const names = getComputedStyle(input).getPropertyValue('anchor-name');
      this.#hold('anchor-name', names && names !== 'none' ? `${names}, ${this.#anchor}` : this.#anchor);
    }

    const on = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.#undo.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(input, 'pointerdown', (e) => this.#pressed(e));
    on(input, 'focus', () => this.#focused());
    on(input, 'blur', () => this.#sync());
    on(input, 'input', () => this.#sync());
    on(input, 'change', () => this.#sync());
    // A form's reset changes the value once its event is over.
    if (input.form) on(input.form, 'reset', () => setTimeout(() => this.#sync()));
    if (!ANCHORED) on(window, 'resize', () => this.#place());
    this.#watchValue();
    this.#observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            this.#restyle();
            this.#sync();
          });
    this.#observer?.observe(input);
    // A password field's "show" button flips its type: the copy never shows a password.
    this.#mutations = new MutationObserver(() => this.#sync());
    this.#mutations.observe(input, { attributes: true, attributeFilter: ['type', 'placeholder'] });
    this.#sync();
  }

  update(options: InputOptions): void {
    this.instance.update(options);
  }

  refresh(): void {
    this.#restyle();
    this.#sync();
    this.instance.refresh();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#observer?.disconnect();
    this.#mutations.disconnect();
    for (const undo of this.#undo.splice(0).reverse()) undo();
    this.#input.removeAttribute(FIELD);
    this.instance.destroy();
    this.#overlay.remove();
  }

  /** Set a style property of the field, until `destroy` gives it back. */
  #hold(property: string, value: string) {
    const style = this.#input.style;
    const [before, priority] = [style.getPropertyValue(property), style.getPropertyPriority(property)];
    style.setProperty(property, value, 'important');
    this.#undo.push(() => style.setProperty(property, before, priority));
  }

  /** Hide the field's own text, or show it as it was. */
  #hide(hidden: boolean) {
    const [value, priority] = hidden ? ['transparent', 'important'] : this.#own;
    this.#input.style.setProperty(FILL, value, priority);
  }

  /**
   * Programmatic changes (a framework setting the value) fire no event:
   * the field's own `value` reports them. Whatever defined it before (React
   * tracks values this way too) still runs, and comes back on `destroy`.
   */
  #watchValue() {
    const input = this.#input;
    const own = Object.getOwnPropertyDescriptor(input, 'value');
    const base = own ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!base?.get || !base.set) return;
    const sync = () => this.#sync();
    Object.defineProperty(input, 'value', {
      configurable: true,
      enumerable: base.enumerable ?? false,
      get(this: HTMLInputElement): unknown {
        return base.get?.call(this);
      },
      set(this: HTMLInputElement, value: string) {
        base.set?.call(this, value);
        sync();
      },
    });
    this.#undo.push(() => {
      if (own) Object.defineProperty(input, 'value', own);
      else delete (input as { value?: string }).value;
    });
  }

  /** Copy the field's box and typography, so the copy's glyphs land where the field's would. */
  #restyle() {
    const input = this.#input;
    const cs = getComputedStyle(input);
    const s = this.#overlay.style;
    for (const p of TYPESET) s.setProperty(p, cs.getPropertyValue(p));
    for (const side of ['top', 'right', 'bottom', 'left']) {
      s.setProperty(`padding-${side}`, cs.getPropertyValue(`padding-${side}`));
      s.setProperty(`border-${side}-width`, cs.getPropertyValue(`border-${side}-width`));
    }
    // A field centres its line in its content box; a line as tall as the box does too.
    const inner = input.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    s.lineHeight = `${Math.max(0, inner)}px`;
    if (ANCHORED) {
      s.setProperty('position-anchor', this.#anchor);
      s.left = 'anchor(left)';
      s.top = 'anchor(top)';
      s.width = 'anchor-size(width)';
      s.height = 'anchor-size(height)';
    } else {
      this.#place();
    }
    this.#paint();
  }

  /** Without anchor positioning: move the copy over the field (both are laid out in the same containing block). */
  #place() {
    const s = this.#overlay.style;
    // From the containing block's corner, not where it would sit in the flow.
    if (s.left === '') [s.left, s.top] = ['0px', '0px'];
    const field = this.#input.getBoundingClientRect();
    const copy = this.#overlay.getBoundingClientRect();
    s.left = `${px(s.left) + field.left - copy.left}px`;
    s.top = `${px(s.top) + field.top - copy.top}px`;
    s.width = `${field.width}px`;
    s.height = `${field.height}px`;
  }

  /** The copy's colour: the field's, or its placeholder's while it's empty. */
  #paint() {
    const input = this.#input;
    const s = this.#overlay.style;
    if (input.value !== '') {
      s.color = getComputedStyle(input).color;
      s.opacity = '';
      return;
    }
    const placeholder = getComputedStyle(input, '::placeholder');
    s.color = placeholder.color;
    s.opacity = placeholder.opacity;
  }

  /** Being edited (focused, with a value to edit), or a password: the field shows its own text. */
  get #editing(): boolean {
    const input = this.#input;
    return (input.matches(':focus') && input.value !== '') || input.type === 'password';
  }

  /** Show the cut copy, or the field's own text, as the field is being edited or not. */
  #sync() {
    if (this.#destroyed) return;
    const input = this.#input;
    const shown = input.getClientRects().length > 0;
    const secret = input.type === 'password';
    const value = secret ? '' : input.value;
    const text = value === '' ? input.placeholder : value;
    const editing = this.#editing;
    // While it's being edited, the copy catches up on blur rather than at every key; a password goes at once.
    if ((!editing || secret) && this.instance.state.text !== text) this.instance.update({ text });
    this.#paint();
    this.#overlay.style.display = shown ? '' : 'none';
    this.#overlay.style.visibility = editing ? 'hidden' : '';
    this.#hide(!editing && value !== '');
    if (!editing) input.scrollLeft = 0;
  }

  /**
   * A press on the field, not yet being edited: show its whole value now,
   * scrolled so the caret the press is about to place lands on the glyph
   * the cut copy showed there. The browser then places it, and a drag
   * selects, as on any field. A touch places it once the field has focus.
   */
  #pressed(e: PointerEvent) {
    const input = this.#input;
    if (e.button !== 0 || this.#editing || input.value === '' || !this.instance.truncated) return;
    const caret = this.#caretAt(e.clientX, e.clientY);
    if (e.pointerType === 'touch') {
      this.#touched = caret;
      return;
    }
    this.#overlay.style.visibility = 'hidden';
    this.#hide(false);
    this.#unplaced = this.#scrollTo(caret, e.clientX) ? null : caret;
    // (Wherever the press ends: a drag can leave the field.)
    if (this.#unplaced !== null) addEventListener('pointerup', () => this.#released(), { once: true, capture: true });
    // Pressed, but not focused (the page prevented it): back as it was.
    requestAnimationFrame(() => this.#sync());
  }

  /**
   * The press ended. Where the field couldn't scroll far enough to put the
   * caret under the pointer (beside an ellipsis, whose gaps the field's
   * text doesn't have), the browser put it a glyph away: it goes where it
   * was pressed, unless a drag selected something.
   */
  #released() {
    const caret = this.#unplaced;
    this.#unplaced = null;
    const input = this.#input;
    if (caret === null || !input.matches(':focus') || input.selectionStart !== input.selectionEnd) return;
    try {
      input.setSelectionRange(caret, caret);
    } catch {
      // (Email fields have no selection to set.)
    }
  }

  #focused() {
    this.#sync();
    const caret = this.#touched;
    this.#touched = null;
    if (caret === null) return;
    try {
      this.#input.setSelectionRange(caret, caret);
    } catch {
      // (Email fields have no selection to set.)
    }
  }

  /** The caret (an offset in the value) nearest `x`, `y` in the cut copy: beside a glyph, or either side of what an ellipsis hides. */
  #caretAt(x: number, y: number): number {
    const t = this.instance;
    const { offsets } = inside(t);
    const j = ellipsisAt(t, x, y);
    if (j >= 0) {
      const r = ellipsisRect(t, j)!;
      const part = t.state.hidden[j]!;
      return offsets[x < r.left + r.width / 2 ? part.start : part.end]!;
    }
    const n = t.graphemes.length;
    for (let i = 0; i < n; i++) {
      const r = graphemeRect(t, i);
      if (r && x < r.left + r.width / 2) return offsets[i]!;
    }
    return offsets[n]!;
  }

  /**
   * Scroll the field so the caret at `offset` sits at `x`, as far as it
   * scrolls. Returns whether it got there. Only for text set from the left.
   */
  #scrollTo(offset: number, x: number): boolean {
    const input = this.#input;
    const cs = getComputedStyle(input);
    if (!/^(start|left|justify)$/.test(cs.textAlign) || cs.direction !== 'ltr') return false;
    const before = input.value.slice(0, offset);
    const spaces = before.split(' ').length - 1;
    const width =
      measure(fontOf(cs), applyTextTransform(before, cs.textTransform)).advance +
      px(cs.letterSpacing) * graphemes(before).length +
      px(cs.wordSpacing) * spaces;
    // (Firefox counts a field's padding in its clientLeft.)
    const start = input.getBoundingClientRect().left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const want = width - (x - start);
    input.scrollLeft = Math.max(0, Math.min(input.scrollWidth - input.clientWidth, want));
    return Math.abs(input.scrollLeft - want) < 0.5;
  }
}
