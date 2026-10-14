/**
 * The marks an ellipsis is made of: characters of a string, or drawn shapes.
 */
import { graphemes } from './graphemes.js';
import {
  type Font,
  type GlyphMetrics,
  applyTextTransform,
  dotSpacing,
  fontAscent,
  fontOf,
  inkGap,
  inkRuns,
  measure,
} from './metrics.js';

export type Shape = 'dot' | 'bullet' | 'ring' | 'square';
export type Length = number | `${number}em` | `${number}px`;

/** Drawn ellipsis marks. Sizes default to the font's own '.' (dot, square) or '•' (bullet, ring). */
export interface MarkStyle {
  shape: Shape;
  /** Number of marks. Default 3. */
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
}

/**
 * - a string is rendered as text; each character is a separate mark, so
 *   '...' can be spaced out while '…' is a single glyph
 * - a `MarkStyle` draws shapes
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
}

export function toPx(value: Length, fontSize: number): number {
  if (typeof value === 'number') return value;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.endsWith('em') ? n * fontSize : n;
}

/** Create the mark elements for an ellipsis. */
export function buildMarks(style: EllipsisStyle): HTMLSpanElement[] {
  const make = (text: string) => {
    const el = document.createElement('span');
    el.setAttribute('data-fp-mark', '');
    el.style.cssText = 'display:inline-block;white-space:pre';
    el.textContent = text;
    return el;
  };
  if (typeof style === 'string') return graphemes(style).map(make);
  return Array.from({ length: Math.max(1, style.count ?? 3) }, () => {
    const el = make('');
    el.setAttribute('data-fp-shape', style.shape);
    return el;
  });
}

/** Plain-text stand-in for an ellipsis style. */
export function ellipsisText(style: EllipsisStyle): string {
  return typeof style === 'string' ? style : '…';
}

const diameter = (m: GlyphMetrics) => (m.left + m.right + m.ascent + m.descent) / 2;

/**
 * Measure the marks with the ellipsis' computed style, and size drawn marks.
 * `elements` are the marks of one ellipsis; `others` get the same drawn style.
 */
export function layoutMarks(style: EllipsisStyle, cs: CSSStyleDeclaration, groups: HTMLElement[][]): MarkLayout {
  const font = fontOf(cs);
  const fontSize = parseFloat(cs.fontSize);
  const ascent = fontAscent(font);
  const spacing = parseFloat(cs.letterSpacing) || 0;

  if (typeof style === 'string') {
    const marks = graphemes(applyTextTransform(style, cs.textTransform));
    const metrics = marks.map((g) => {
      const m = measure(font, g);
      return spacing ? { ...m, advance: m.advance + spacing } : m;
    });
    const natural = metrics.slice(1).map((m, i) => inkGap(metrics[i]!, m));
    const single = marks.length === 1;
    return {
      font,
      fontSize,
      ascent,
      drawn: false,
      metrics,
      natural,
      inner: natural.map(() => 0),
      rhythm: single ? dotSpacing(font, marks[0]!) : natural.length ? natural.reduce((s, v) => s + v, 0) / natural.length : null,
      runs: single ? inkRuns(font, marks[0]!) : null,
    };
  }

  // Drawn shapes take their size and height from the font's own glyphs.
  const round = style.shape === 'bullet' || style.shape === 'ring';
  const reference = measure(font, style.like ?? (round ? '•' : '.'));
  const period = measure(font, '.');
  const parts = style.like ? inkRuns(font, style.like) : [];
  const natural = parts.length
    ? parts.reduce((s, [a, b]) => s + b - a, 0) / parts.length
    : diameter(reference);
  const d = style.size !== undefined ? toPx(style.size, fontSize) : natural;
  const middle = (reference.ascent - reference.descent) / 2;
  const bottom = middle - d / 2;
  const own = style.like ? dotSpacing(font, style.like) : null;
  const rhythm = style.spacing !== undefined
    ? toPx(style.spacing, fontSize)
    : own ?? (dotSpacing(font, '…') ?? diameter(period) * 0.8) * (d / Math.max(0.01, diameter(period)));
  const count = groups[0]?.length ?? style.count ?? 3;
  const m: GlyphMetrics = { advance: d, left: 0, right: d, ascent: bottom + d, descent: -bottom };

  const shapeCss =
    style.shape === 'ring'
      ? `box-sizing:border-box;border:${Math.max(1, d * 0.16)}px solid currentColor;border-radius:50%`
      : `background:currentColor;border-radius:${style.shape === 'square' ? 0 : '50%'}`;
  const css = `display:inline-block;white-space:pre;width:${d}px;height:${d}px;vertical-align:${bottom}px;${shapeCss}`;
  for (const group of groups) {
    for (const el of group) {
      // Keep the margin set by spacing; only rewrite the shape when it changes.
      if (el.dataset.fpCss !== css) {
        const margin = el.style.marginLeft;
        el.style.cssText = css;
        el.style.marginLeft = margin;
        el.dataset.fpCss = css;
      }
    }
  }
  return {
    font,
    fontSize,
    ascent,
    drawn: true,
    metrics: Array.from({ length: count }, () => m),
    natural: Array.from({ length: count - 1 }, () => 0),
    inner: Array.from({ length: count - 1 }, () => rhythm),
    rhythm,
    runs: null,
  };
}

/** Metrics of the whole ellipsis, given the extra space before each mark after the first. */
export function groupMetrics(layout: MarkLayout, inner: readonly number[]): GlyphMetrics {
  const { metrics } = layout;
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
