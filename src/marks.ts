/**
 * The marks an ellipsis is made of: characters of a string, or drawn shapes.
 */
import { graphemes } from './graphemes.ts';
import {
  type Font,
  type GlyphMetrics,
  applyTextTransform,
  dotSpacing,
  fontAscent,
  fontOf,
  inkBox,
  inkGap,
  inkRuns,
  measure,
  metricsVersion,
} from './metrics.ts';
import { repeatRatio, wraps } from './options.ts';

export type Shape = 'dot' | 'bullet' | 'ring' | 'square';
export type Length = number | `${number}em` | `${number}px`;

/** Drawn ellipsis marks. Sizes default to the font's own '.' (dot, square) or '•' (bullet, ring). */
export interface MarkStyle {
  shape: Shape;
  /** Number of marks, 0 or more. Default 3 (3 per cell with `cells`). With 0 the ellipsis is just a gap. */
  count?: number;
  /** Diameter. Default from the font. */
  size?: Length;
  /** Space between marks. Default: the font's own ellipsis rhythm, scaled to the mark size. */
  spacing?: Length;
  /**
   * Size, place and space the marks like the separate parts of this glyph,
   * e.g. `'…'`: the result looks like the font's ellipsis, with dots that can
   * be spaced independently.
   */
  like?: string;
  /**
   * Where the marks sit: 'baseline' (default), where the font's '.' (or
   * `like`) sits, or 'middle', the middle of an ideograph's box, where
   * Chinese and Japanese set their dots.
   */
  align?: 'baseline' | 'middle';
  /**
   * Take this many of the cells Chinese and Japanese text is set in (each
   * as wide as an ideograph), each mark centred in its share of them, so the
   * text after the ellipsis stays in its columns. The ellipsis then keeps
   * its width: no gaps are added beside it, nor slack spread into it.
   */
  cells?: number;
}

/**
 * - a string is rendered as text; each character is a separate mark, so
 *   '...' can be spaced out while '…' is a single glyph. Dots in brackets,
 *   like '[…]' or '(...)', are one mark, set like a word.
 * - a `MarkStyle` draws shapes
 * - 'auto': six dots in the middle of two cells (one on a single line) for
 *   Chinese and Japanese text, '…' for any other
 */
export type EllipsisStyle = string | MarkStyle;

/** Measurements of the marks for one layout pass. */
export interface MarkLayout {
  font: Font;
  fontSize: number;
  /** Font ascent, to find the baseline in the ellipsis box. */
  ascent: number;
  drawn: boolean;
  /** Per mark, relative to its own origin; text marks include letter-spacing. */
  metrics: GlyphMetrics[];
  /** Ink gap between consecutive marks with no extra spacing. */
  natural: number[];
  /** Extra space before marks 1..n-1 by default. */
  inner: number[];
  /** Space between marks, for `gap: 'dots'`. Null when unknown. */
  rhythm: number | null;
  /** For a single text mark: its separate parts (the dots of '…'), in px from its ink's left edge. */
  runs: [number, number][] | null;
  /** Drawn marks: their inline style (see `styleMarks`). */
  css: string | null;
  /** Every mark is the same, so `repeat` can add more of them. */
  repeats: boolean;
  /** Set like a word (dots in brackets): `rhythm` is a word space. */
  word: boolean;
  /** The cells the ellipsis takes (see `MarkStyle.cells`), or 0 for none. */
  cells: number;
  /** How wide those cells are, in px: the ellipsis' width, its marks set over them (see `onCells`). */
  span: number;
}

/**
 * Layout's unit, as parts of a px: Firefox lays out in 1/60 px, Chromium
 * and WebKit in 1/64. A length that is a whole number of them isn't rounded.
 */
export const UNIT: number = typeof navigator !== 'undefined' && /\bGecko\/\d/.test(navigator.userAgent) ? 60 : 64;

/** `px` to the nearest whole number of layout's units. */
export const toUnit = (px: number): number => Math.round(px * UNIT) / UNIT;

export function toPx(value: Length, fontSize: number): number {
  if (typeof value === 'number') return value;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.endsWith('em') ? n * fontSize : n;
}

/** How many dots the horizontal dotted characters are made of. */
const DOTS_IN: Record<string, number> = { '…': 3, '⋯': 3, '‥': 2 };

/** Brackets that enclose an ellipsis in a quotation, as `[…]` marks words left out. */
const BRACKETS = new Set(['[]', '()', '<>', '{}', '⟨⟩', '«»', '‹›', '［］', '（）', '〔〕', '【】']);
const DOTTED = /^[.…⋯‥·]$/u;

/** Whether `style` is dots in brackets, like '[…]' or '(...)': one mark, its brackets hugging its dots. */
export function enclosed(style: EllipsisStyle): style is string {
  if (typeof style !== 'string') return false;
  const g = graphemes(style);
  return g.length >= 3 && BRACKETS.has(g[0]! + g.at(-1)!) && g.slice(1, -1).every((c) => DOTTED.test(c));
}

/** The marks of a string ellipsis: each grapheme, or all of it for one enclosed in brackets. */
const marksOf = (text: string): string[] => (enclosed(text) ? [text] : graphemes(text));

/**
 * The marks actually drawn. `'auto'` is decided by the text (`cjk`). Then
 * `justify: 'dots'` and `repeat` need separate marks, so a single glyph like
 * '…' is redrawn as dots sized and placed like its own.
 */
export function markStyleFor(
  settings: { ellipsis: EllipsisStyle; justify: unknown; repeat: boolean | number; lines: number | 'fit' },
  cjk = false,
): EllipsisStyle {
  const e = settings.ellipsis === 'auto' ? autoStyle(cjk, wraps(settings.lines)) : settings.ellipsis;
  const split = settings.justify === 'dots' || repeatRatio(settings.repeat) > 0;
  if (split && typeof e === 'string' && graphemes(e).length === 1) return { shape: 'dot', like: e, count: DOTS_IN[e] ?? 1 };

  return e;
}

/**
 * The ellipsis `'auto'` stands for. Chinese and Japanese set theirs in the
 * middle of the line, six dots over two cells in running text; one cell's
 * worth is the usual cut of a single line.
 */
function autoStyle(cjk: boolean, wrapping: boolean): EllipsisStyle {
  if (!cjk) return '…';
  const cells = wrapping ? 2 : 1;
  return { shape: 'dot', like: '…', count: 3 * cells, cells, align: 'middle' };
}

/** How many marks `style` draws (before `repeat` adds any). */
export const markCount = (style: EllipsisStyle): number =>
  typeof style === 'string' ? marksOf(style).length : Math.max(0, Math.round(style.count ?? 3 * Math.max(1, style.cells ?? 1)));

/** Create the mark elements for an ellipsis. */
export function buildMarks(style: EllipsisStyle): HTMLSpanElement[] {
  const make = (text: string) => {
    const el = document.createElement('span');
    el.setAttribute('data-fp-mark', '');
    el.style.cssText = 'display:inline-block;white-space:pre';
    el.textContent = text;
    return el;
  };
  if (typeof style === 'string') return marksOf(style).map(make);
  return Array.from({ length: markCount(style) }, () => {
    const el = make('');
    el.setAttribute('data-fp-shape', style.shape);
    return el;
  });
}

/** Plain-text stand-in for the marks drawn (see `markStyleFor`): '……' for two cells. */
export function ellipsisText(style: EllipsisStyle): string {
  return typeof style === 'string' ? style : (style.like ?? '…').repeat(Math.max(1, style.cells ?? 1));
}

const diameter = (m: GlyphMetrics) => (m.left + m.right + m.ascent + m.descent) / 2;

/**
 * Measure the marks with the ellipsis' computed style, and size drawn marks
 * (`count` of them), with `letterSpacing` in place of the style's when
 * given. Only reads: `styleMarks` applies the drawn style.
 */
export function layoutMarks(
  style: EllipsisStyle,
  cs: CSSStyleDeclaration,
  count: number,
  letterSpacing = parseFloat(cs.letterSpacing),
): MarkLayout {
  const font = fontOf(cs);
  const fontSize = parseFloat(cs.fontSize);
  const transform = cs.textTransform;
  // The same marks, set the same way, measure the same (until fonts load):
  // the same layout, which tells a pass that nothing changed.
  const marks =
    typeof style === 'string'
      ? style
      : `${style.shape} ${style.count} ${style.size} ${style.spacing} ${style.like} ${style.align} ${style.cells}`;
  const key = `${marks}|${font.css}|${fontSize}|${letterSpacing}|${transform}|${count}|${metricsVersion()}`;
  let layout = layouts.get(key);
  if (!layout) {
    if (layouts.size > 256) layouts.clear();
    layouts.set(key, (layout = measureMarks(style, font, fontSize, letterSpacing, transform, count)));
  }
  return layout;
}

/** Mark layouts by the marks and how they're set (see `layoutMarks`). */
const layouts = new Map<string, MarkLayout>();

function measureMarks(
  style: EllipsisStyle,
  font: Font,
  fontSize: number,
  letterSpacing: number,
  transform: string,
  count: number,
): MarkLayout {
  const ascent = fontAscent(font);
  const spacing = Number.isFinite(letterSpacing) ? letterSpacing : 0;

  if (typeof style === 'string') {
    const text = applyTextTransform(style, transform);
    const marks = marksOf(text);
    // Letter-spacing follows every grapheme, inside a mark too.
    const spaced = (m: GlyphMetrics, n: number) =>
      spacing !== 0 ? { ...m, advance: m.advance + n * spacing, right: m.right + (n - 1) * spacing } : m;
    const metrics = marks.map((g) => spaced(measure(font, g), graphemes(g).length));
    const natural = metrics.slice(1).map((m, i) => inkGap(metrics[i]!, m));
    const single = marks.length === 1;
    const word = enclosed(text);
    // With no marks at all the ellipsis is a gap; keep it as wide as the
    // font's own dot rhythm so the text on either side doesn't run together.
    const none = marks.length === 0 ? (dotSpacing(font, '…') ?? fontSize * 0.2) : null;
    const rhythm = word
      ? wordGap(font, metrics[0]!, spaced)
      : (none ?? (single ? dotSpacing(font, marks[0]!) : natural.length > 0 ? natural.reduce((s, v) => s + v, 0) / natural.length : null));
    const runs = single ? inkRuns(font, marks[0]!) : null;
    return {
      font,
      fontSize,
      ascent,
      drawn: false,
      metrics,
      natural,
      inner: natural.map(() => 0),
      rhythm,
      // An enclosed ellipsis' marks are its dots, not its brackets.
      runs: word && runs && runs.length > 2 ? runs.slice(1, -1) : runs,
      css: null,
      repeats: marks.length > 1 && marks.every((g) => g === marks[0]),
      word,
      cells: 0,
      span: 0,
    };
  }

  // Drawn shapes take their size and height from the font's own glyphs.
  const round = style.shape === 'bullet' || style.shape === 'ring';
  const reference = measure(font, style.like ?? (round ? '•' : '.'));
  const period = measure(font, '.');
  const parts = style.like ? inkRuns(font, style.like) : [];
  const natural = parts.length > 0 ? parts.reduce((s, [a, b]) => s + b - a, 0) / parts.length : diameter(reference);
  // A whole number of layout's units, so many of them add up exactly (see `repeat`).
  const d = toUnit(style.size !== undefined ? toPx(style.size, fontSize) : natural);
  // An ideograph's box is the em square, and '口' fills it: its middle is the box's.
  const centre = style.align === 'middle' ? measure(font, '口') : reference;
  const middle = (centre.ascent - centre.descent) / 2;
  const bottom = middle - d / 2;
  const own = style.like ? dotSpacing(font, style.like) : null;
  const cells = Math.max(0, style.cells ?? 0);
  // As an ideograph sets them: its advance, and the letter-spacing after it.
  const span = cells * (measure(font, CELL).advance + spacing);
  const rhythm =
    cells > 0
      ? span / Math.max(1, count) - d
      : style.spacing !== undefined
        ? toPx(style.spacing, fontSize)
        : (own ?? (dotSpacing(font, '…') ?? diameter(period) * 0.8) * (d / Math.max(0.01, diameter(period))));
  const m: GlyphMetrics = { advance: d, left: 0, right: d, ascent: bottom + d, descent: -bottom };

  const shapeCss =
    style.shape === 'ring'
      ? `box-sizing:border-box;border:${Math.max(1, d * 0.16)}px solid currentColor;border-radius:50%`
      : `background:currentColor;border-radius:${style.shape === 'square' ? 0 : '50%'}`;
  // On cells, marks are set over the ideographs that take the room (see
  // `onCells`), from the top of the ellipsis' box, its font's ascent above
  // the baseline.
  const place = cells > 0 ? `position:absolute;top:${ascent - bottom - d}px` : `display:inline-block;vertical-align:${bottom}px`;
  // In forced-colors mode backgrounds are overridden, which would erase the
  // marks; opting out keeps them in the (forced) text colour.
  const css = `${place};white-space:pre;width:${d}px;height:${d}px;forced-color-adjust:none;${shapeCss}`;
  return {
    font,
    fontSize,
    ascent,
    drawn: true,
    metrics: Array.from({ length: count }, () => m),
    natural: Array.from({ length: Math.max(0, count - 1) }, () => 0),
    inner: Array.from({ length: Math.max(0, count - 1) }, () => (cells > 0 ? 0 : rhythm)),
    rhythm,
    runs: null,
    css,
    repeats: count > 0 && cells === 0,
    word: false,
    cells,
    span,
  };
}

/** The ideograph whose box is a cell. */
const CELL = '一';

/** What takes the room of `cells` cells: ideographs, set as the text around them is. */
export const cellsText = (cells: number): string => CELL.repeat(Math.max(0, Math.round(cells)));

/**
 * Put marks on cells (see `MarkStyle.cells`): each centred in its share of
 * the ellipsis, as wide as its cells are laid out, so a line that is
 * justified, and spaces its ideographs apart, spaces the marks with them.
 */
export function onCells(marks: readonly HTMLElement[], d: number): void {
  marks.forEach((el, k) => {
    const left = `calc(${((k + 0.5) / marks.length) * 100}% - ${d / 2}px)`;
    if (el.style.left !== left) el.style.left = left;
  });
}

/**
 * The ink gap a word space leaves before and after an ellipsis set like a
 * word (`mark`), next to an 'n': what `gap: 'dots'` keeps either side of it.
 */
function wordGap(font: Font, mark: GlyphMetrics, spaced: (m: GlyphMetrics, n: number) => GlyphMetrics): number {
  const n = spaced(measure(font, 'n'), 1);
  const space = spaced(measure(font, ' '), 1).advance;
  return (inkGap(n, mark) + inkGap(mark, n)) / 2 + space;
}

/** Give drawn marks their shape (see `MarkLayout.css`), keeping the margins set by spacing. */
export function styleMarks(marks: readonly HTMLElement[], css: string): void {
  for (const el of marks) {
    if (styled.get(el) === css) continue;
    const margin = el.style.marginLeft;
    el.style.cssText = css;
    el.style.marginLeft = margin;
    styled.set(el, css);
  }
}

/** The style `styleMarks` last gave each mark. */
const styled = new WeakMap<HTMLElement, string>();

/**
 * The ink box of each mark drawing an ellipsis, as laid out in `ellipsis`.
 * For a single glyph like '…' the dots are found in the glyph itself. Marks
 * past the layout's (repeated, see `MarkLayout.repeats`) are like its last.
 */
export function markInk(layout: MarkLayout, marks: readonly HTMLElement[], ellipsis: HTMLElement): DOMRect[] {
  if (layout.drawn) return marks.map((m) => m.getBoundingClientRect());
  const baseline = ellipsis.getBoundingClientRect().top + layout.ascent;
  const boxes = marks.map((el, i) => inkBox((layout.metrics[i] ?? layout.metrics.at(-1))!, el.getBoundingClientRect().left, baseline));
  const ink = boxes[0];
  if (boxes.length !== 1 || !ink || !layout.runs || layout.runs.length <= 1) return boxes;
  return layout.runs.map(([a, b]) => new DOMRect(ink.left + a, ink.top, b - a, ink.height));
}

/** Metrics of the whole ellipsis, given the extra space before each mark after the first. */
export function groupMetrics(layout: MarkLayout, inner: readonly number[]): GlyphMetrics {
  const { metrics, span } = layout;
  if (layout.cells > 0) {
    // Its cells' width, its first and last marks centred in their shares of it.
    const m = metrics[0];
    if (!m) return { advance: span, left: 0, right: 0, ascent: 0, descent: 0 };
    const inset = span / metrics.length / 2 - m.advance / 2;
    return { advance: span, left: -inset, right: span - inset, ascent: m.ascent, descent: m.descent };
  }
  if (metrics.length === 0) return { advance: 0, left: 0, right: 0, ascent: 0, descent: 0 };
  let origin = 0;
  let ascent = 0;
  let descent = 0;
  metrics.forEach((m, i) => {
    if (i > 0) origin += metrics[i - 1]!.advance + (inner[i - 1] ?? 0);
    ascent = Math.max(ascent, m.ascent);
    descent = Math.max(descent, m.descent);
  });
  const last = metrics[metrics.length - 1]!;
  return { advance: origin + last.advance, left: metrics[0]!.left, right: origin + last.right, ascent, descent };
}
