/**
 * Inputs (`floating-ellipsis/input`): an input or a textarea shows its value
 * truncated to fit while it isn't being edited, and all of it once it is,
 * with the caret where it was pressed and the glyph (in a textarea, the line)
 * under the pointer staying put.
 */
import { type Elide, elide } from './elide.ts';
import { ellipsisAt, ellipsisRect, graphemeRect } from './geometry.ts';
import { graphemes } from './graphemes.ts';
import { inside } from './inside.ts';
import { applyTextTransform, fontOf, measure } from './metrics.ts';
import type { ElideOptions } from './options.ts';

/** `elide`'s options that make sense for an input's one line. */
export type InputOptions = Omit<ElideOptions, 'text' | 'lines' | 'find' | 'suffix' | 'autoSize' | 'glyphs' | 'title' | 'copy'>;

/** A textarea's: an input's, and `lines` (`'fit'` by default: as many as its height holds). */
export type TextareaOptions = InputOptions & Pick<ElideOptions, 'lines'>;

/** An input or a textarea whose value shows truncated while it isn't being edited. */
export interface ElidedInput<O extends InputOptions = InputOptions> {
  /** The instance truncating the value (or the placeholder) for show. */
  readonly instance: Elide;
  update(options: O): void;
  /** Read the input's style and value again, after a change nothing reports: a class that changes its font, say. */
  refresh(): void;
  /** Show the input as it was. */
  destroy(): void;
}

const FIELD = 'data-fp-input';
/** What hides the input's own text: not its colour, which its caret and the copy take. */
const FILL = '-webkit-text-fill-color';

/** Where CSS anchor positioning works, the copy follows the input wherever it goes. */
const ANCHORED = typeof CSS !== 'undefined' && CSS.supports('anchor-name', '--a');

/** The copy: over the input's text, unseen by pointers, screen readers and find in page. */
const OVERLAY =
  'position:absolute;box-sizing:border-box;margin:0;border-style:solid;border-color:transparent;background:none;' +
  'pointer-events:none;overflow:hidden;white-space:pre;direction:ltr;z-index:auto';

/** Typography the copy takes from the input, so its glyphs land on the input's. */
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

/** And what a textarea wraps its lines by. */
const WRAPPING = ['white-space', 'overflow-wrap', 'word-break', 'line-break', 'hyphens', 'tab-size', 'text-indent', 'line-height'] as const;

/**
 * The input's native placeholder gives way to the copy's, which is truncated the
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
 * Show `input`'s value truncated to fit, as `elide` would truncate it, while
 * it isn't being edited, and its placeholder truncated while it's empty.
 * Pressing the input shows the whole value under the pointer where the
 * truncated one was: the caret lands on the glyph pressed (or beside what a
 * pressed ellipsis hides) and dragging selects as usual. The value, the input
 * and what's submitted stay as they are; a copy of the truncated text lies
 * over the input's own, which is hidden while the copy shows.
 *
 * A textarea's value wraps as the textarea wraps it, on as many lines as its
 * height holds (or `lines`), and a press keeps the line pressed under the
 * pointer.
 *
 * ```js
 * elideInput(document.querySelector('input[name=path]'), { position: 'middle', keep: /[^/]+$/ });
 * elideInput(document.querySelector('textarea'), { position: 'end' });
 * ```
 */
export function elideInput(input: HTMLInputElement, options?: InputOptions): ElidedInput;
export function elideInput(textarea: HTMLTextAreaElement, options?: TextareaOptions): ElidedInput<TextareaOptions>;
export function elideInput(input: HTMLInputElement | HTMLTextAreaElement, options: TextareaOptions = {}): ElidedInput<TextareaOptions> {
  return new Field(input, options);
}

class Field implements ElidedInput<TextareaOptions> {
  readonly instance: Elide;
  readonly #input: HTMLInputElement | HTMLTextAreaElement;
  /** A textarea: its lines wrap. */
  readonly #area: boolean;
  readonly #overlay: HTMLDivElement = document.createElement('div');
  readonly #anchor = `--fp-input-${nextId++}`;
  readonly #observer: ResizeObserver | null;
  readonly #mutations: MutationObserver;
  readonly #undo: (() => void)[] = [];
  /** A touch pressed this caret offset: placed once the input has focus. */
  #touched: number | null = null;
  /** The input couldn't scroll a pressed caret under the pointer: placed once the press ends, unless it dragged. */
  #unplaced: number | null = null;
  /** The input's own inline values (and priorities) of the properties `#toggle` sets. */
  readonly #own = new Map<string, [string, string]>();
  /** A textarea's copy's right padding: its own, and the room its scrollbar takes. */
  #padding = '';
  #destroyed = false;

  constructor(input: HTMLInputElement | HTMLTextAreaElement, options: TextareaOptions) {
    this.#input = input;
    this.#area = input instanceof HTMLTextAreaElement;
    const overlay = this.#overlay;
    overlay.setAttribute('data-fp-input-copy', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    overlay.style.cssText = OVERLAY;
    input.setAttribute(FIELD, '');
    for (const p of [FILL, 'overflow-y', 'scrollbar-gutter'])
      this.#own.set(p, [input.style.getPropertyValue(p), input.style.getPropertyPriority(p)]);
    this.#undo.push(() => {
      for (const [p, own] of this.#own) input.style.setProperty(p, ...own);
    });
    this.#settle();
    this.instance = elide(overlay, { ...options, lines: this.#area ? (options.lines ?? 'fit') : 1, text: '', find: false });
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
    // A password input's "show" button flips its type: the copy never shows a password.
    this.#mutations = new MutationObserver(() => this.#sync());
    this.#mutations.observe(input, { attributes: true, attributeFilter: ['type', 'placeholder'] });
    this.#sync();
  }

  update(options: TextareaOptions): void {
    this.instance.update(this.#area ? options : { ...options, lines: 1 });
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

  /** Set a style property of the input, until `destroy` gives it back. */
  #hold(property: string, value: string) {
    const style = this.#input.style;
    const [before, priority] = [style.getPropertyValue(property), style.getPropertyPriority(property)];
    style.setProperty(property, value, 'important');
    this.#undo.push(() => style.setProperty(property, before, priority));
  }

  /** Set a style property of the input, or (with null) give it its own back. */
  #toggle(property: string, value: string | null) {
    const [v, priority] = value === null ? this.#own.get(property)! : [value, 'important'];
    this.#input.style.setProperty(property, v, priority);
  }

  /** Hide the input's own text, or show it as it was. */
  #hide(hidden: boolean) {
    this.#toggle(FILL, hidden ? 'transparent' : null);
  }

  /**
   * A textarea showing the copy doesn't scroll, so the wheel goes on to the
   * page and no scrollbar shows beside text that fits. The room its
   * scrollbar takes stays while its whole value needs one, so the value
   * wraps the same once it shows.
   */
  #still(still: boolean) {
    if (!this.#area) return;
    const input = this.#input;
    this.#toggle('overflow-y', null);
    this.#toggle('scrollbar-gutter', null);
    if (!still) return;
    // (Firefox says a textarea's `auto` is `visible`.)
    if (/^(auto|visible)$/.test(getComputedStyle(input).overflowY)) {
      const overflows = input.scrollHeight > input.clientHeight;
      this.#toggle('overflow-y', 'hidden');
      if (overflows) this.#toggle('scrollbar-gutter', 'stable');
    }
    this.#gutter();
  }

  /**
   * Programmatic changes (a framework setting the value) fire no event:
   * the input's own `value` reports them. Whatever defined it before (React
   * tracks values this way too) still runs, and comes back on `destroy`.
   */
  #watchValue() {
    const input = this.#input;
    const own = Object.getOwnPropertyDescriptor(input, 'value');
    const base = own ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input) as object, 'value');
    if (!base?.get || !base.set) return;
    const sync = () => this.#sync();
    Object.defineProperty(input, 'value', {
      configurable: true,
      enumerable: base.enumerable ?? false,
      get(this: HTMLInputElement | HTMLTextAreaElement): unknown {
        return base.get?.call(this);
      },
      set(this: HTMLInputElement | HTMLTextAreaElement, value: string) {
        base.set?.call(this, value);
        sync();
      },
    });
    this.#undo.push(() => {
      if (own) Object.defineProperty(input, 'value', own);
      else delete (input as { value?: string }).value;
    });
  }

  /** Copy the input's box and typography, so the copy's glyphs land where the input's would. */
  #restyle() {
    const input = this.#input;
    const cs = getComputedStyle(input);
    const s = this.#overlay.style;
    for (const p of TYPESET) s.setProperty(p, cs.getPropertyValue(p));
    for (const side of ['top', 'right', 'bottom', 'left']) {
      s.setProperty(`padding-${side}`, cs.getPropertyValue(`padding-${side}`));
      s.setProperty(`border-${side}-width`, cs.getPropertyValue(`border-${side}-width`));
    }
    if (this.#area) {
      for (const p of WRAPPING) s.setProperty(p, cs.getPropertyValue(p));
      this.#gutter(cs);
    } else {
      // An input centres its line in its content box; a line as tall as the box does too.
      const inner = input.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      s.lineHeight = `${Math.max(0, inner)}px`;
    }
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

  /** A textarea's lines are as wide as its content box: beside its scrollbar, the copy's are too. */
  #gutter(cs = getComputedStyle(this.#input)) {
    const input = this.#input;
    const gutter = input.getBoundingClientRect().width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - input.clientWidth;
    // (`clientWidth` is rounded.)
    const padding = `${px(cs.paddingRight) + (gutter < 2 ? 0 : gutter)}px`;
    this.#overlay.style.paddingRight = padding;
    if (this.#padding === padding) return;
    // Its box stays the size it was: nothing else reports less room.
    if (this.#padding !== '') this.instance.refresh();
    this.#padding = padding;
  }

  /** Without anchor positioning: move the copy over the input (both are laid out in the same containing block). */
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

  /** The copy's colour: the input's, or its placeholder's while it's empty. */
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

  /** Being edited (focused, with a value to edit), or a password: the input shows its own text. */
  get #editing(): boolean {
    const input = this.#input;
    return (input.matches(':focus') && input.value !== '') || input.type === 'password';
  }

  /**
   * The copy beside the input, and the sheet hiding the input's own
   * placeholder in its document (or shadow root): again whenever it syncs,
   * for an input made before it was put in the page, or moved since.
   */
  #settle() {
    const input = this.#input;
    if (this.#overlay.parentNode !== input.parentNode) input.after(this.#overlay);
    adopt(input);
  }

  /** Show the truncated copy, or the input's own text, as the input is being edited or not. */
  #sync() {
    if (this.#destroyed) return;
    this.#settle();
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
    this.#still(!editing && value !== '');
    if (editing) return;
    input.scrollLeft = 0;
    input.scrollTop = 0;
  }

  /**
   * A press on the input, not yet being edited: show its whole value now,
   * scrolled so the caret the press is about to place lands on the glyph
   * the truncated copy showed there. The browser then places it, and a drag
   * selects, as on any input. A textarea is scrolled so the line pressed
   * stays under the pointer; its glyphs needn't, so the caret goes beside the
   * one pressed once the press ends. A touch places it once the input has
   * focus.
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
    this.#still(false);
    if (this.#area) this.#lineTo(caret, e.clientY);
    this.#unplaced = !this.#area && this.#scrollTo(caret, e.clientX) ? null : caret;
    // (Wherever the press ends: a drag can leave the input.)
    if (this.#unplaced !== null) addEventListener('pointerup', () => this.#released(), { once: true, capture: true });
    // Pressed, but not focused (the page prevented it): back as it was.
    requestAnimationFrame(() => this.#sync());
  }

  /**
   * The press ended. Where the input couldn't scroll far enough to put the
   * caret under the pointer (beside an ellipsis, whose gaps the input's
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
      // (Email inputs have no selection to set.)
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
      // (Email inputs have no selection to set.)
    }
  }

  /**
   * The caret (an offset in the value) nearest `x`, `y` in the truncated
   * copy: beside a glyph on the line nearest `y`, or either side of what an
   * ellipsis hides.
   */
  #caretAt(x: number, y: number): number {
    const t = this.instance;
    const { offsets } = inside(t);
    const j = ellipsisAt(t, x, y);
    if (j >= 0) {
      const r = ellipsisRect(t, j)!;
      const part = t.state.hidden[j]!;
      return offsets[x < r.left + r.width / 2 ? part.start : part.end]!;
    }
    const shown: { i: number; r: DOMRect }[] = [];
    t.graphemes.forEach((g, i) => {
      const r = g === '\n' ? null : graphemeRect(t, i);
      if (r) shown.push({ i, r });
    });
    const off = ({ r }: { r: DOMRect }) => Math.max(0, r.top - y, y - r.bottom);
    const near = Math.min(...shown.map(off));
    const line = shown.filter((g) => off(g) <= near + 0.5);
    for (const { i, r } of line) if (x < r.left + r.width / 2) return offsets[i]!;
    const last = line.at(-1);
    if (!last) return offsets[t.graphemes.length]!;
    // Past the end of a line that wraps, the caret stays on it: before the space it wrapped at.
    const wrapped = last !== shown.at(-1) && /^\s$/.test(t.graphemes[last.i]!);
    return offsets[wrapped ? last.i : last.i + 1]!;
  }

  /**
   * Scroll the textarea so the line holding the caret at `offset` lies at
   * `y`, as far as it scrolls: found in a copy of the whole value, laid out
   * as the textarea lays it out.
   */
  #lineTo(offset: number, y: number) {
    const input = this.#input;
    const value = input.value;
    const mirror = document.createElement('div');
    mirror.style.cssText = this.#overlay.style.cssText;
    mirror.style.visibility = 'hidden';
    // (The space gives a caret after a last line break its line.)
    const text = document.createTextNode(`${value} `);
    mirror.append(text);
    this.#overlay.after(mirror);
    // A caret before a line break is on the line the break ends.
    const before = value[offset] === '\n' && offset > 0 && value[offset - 1] !== '\n';
    const start = before ? offset - (/[\uDC00-\uDFFF]/.test(value[offset - 1]!) ? 2 : 1) : offset;
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + (/[\uD800-\uDBFF]/.test(value[start] ?? '') ? 2 : 1));
    const r = range.getClientRects()[0];
    const top = mirror.getBoundingClientRect().top;
    mirror.remove();
    if (!r) return;
    input.scrollTop = (r.top + r.bottom) / 2 - top - (y - input.getBoundingClientRect().top);
  }

  /**
   * Scroll the input so the caret at `offset` sits at `x`, as far as it
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
    // (Firefox counts an input's padding in its clientLeft.)
    const start = input.getBoundingClientRect().left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const want = width - (x - start);
    input.scrollLeft = Math.max(0, Math.min(input.scrollWidth - input.clientWidth, want));
    return Math.abs(input.scrollLeft - want) < 0.5;
  }
}
