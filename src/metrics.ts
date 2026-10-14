/**
 * Glyph measurement and the balanced-gap math.
 *
 * Kerning is ignored on purpose: glyphs are treated as boxes placed one
 * advance after another, and the visible gap between two glyphs is the
 * distance between their ink (bounding box) edges.
 */

/** Horizontal metrics of a glyph, relative to its pen origin. */
export interface GlyphMetrics {
  /** Advance width, including letter-spacing. */
  advance: number;
  /** How far ink extends left of the origin (negative = ink starts right of it). */
  left: number;
  /** How far ink extends right of the origin. */
  right: number;
  /** Ink height above the baseline. */
  ascent: number;
  /** Ink depth below the baseline. */
  descent: number;
}

export type Gap = 'dots' | 'natural' | 'none' | number | `${number}em` | `${number}px`;

export interface GapPlan {
  /** Extra space to put before the ellipsis (may be negative). */
  marginLeft: number;
  /** Extra space to put after the ellipsis (may be negative). */
  marginRight: number;
  /** Target ink-to-ink gap on each side, or null when spacing is untouched. */
  target: number | null;
  /** Ink gap left of the ellipsis without adjustment (null = no glyph there). */
  naturalLeft: number | null;
  /** Ink gap right of the ellipsis without adjustment (null = no glyph there). */
  naturalRight: number | null;
}

/**
 * Ink gap between glyph `a` and glyph `b` when `b` is placed right after `a`.
 *   a ink right  = origin + a.right
 *   b ink left   = origin + a.advance - b.left
 */
export function inkGap(a: GlyphMetrics, b: GlyphMetrics): number {
  return a.advance - a.right - b.left;
}

/**
 * Margins that make the ink gap on both sides of the ellipsis equal to the
 * target. `before`/`after` are the glyphs touching the ellipsis (null when
 * the ellipsis sits at the very start or end of the text).
 */
export function planGap(
  before: GlyphMetrics | null,
  ellipsis: GlyphMetrics,
  after: GlyphMetrics | null,
  target: number | 'natural' | 'none',
): GapPlan {
  const naturalLeft = before ? inkGap(before, ellipsis) : null;
  const naturalRight = after ? inkGap(ellipsis, after) : null;
  if (target === 'none') return { marginLeft: 0, marginRight: 0, target: null, naturalLeft, naturalRight };

  let t: number;
  if (target === 'natural') {
    const sides = [naturalLeft, naturalRight].filter((v): v is number => v !== null);
    t = sides.length > 0 ? sides.reduce((s, v) => s + v, 0) / sides.length : 0;
  } else {
    t = target;
  }
  return {
    marginLeft: naturalLeft === null ? 0 : t - naturalLeft,
    marginRight: naturalRight === null ? 0 : t - naturalRight,
    target: t,
    naturalLeft,
    naturalRight,
  };
}

/** Separate marks along a row of pixel columns (true = inked), as `[start, end)` column runs. */
export function columnRuns(inked: ArrayLike<boolean>): [number, number][] {
  const runs: [number, number][] = [];
  for (let x = 0; x < inked.length; x++) {
    if (!inked[x]) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === x) last[1] = x + 1;
    else runs.push([x, x + 1]);
  }
  return runs;
}

/** Gaps between consecutive runs, e.g. the two gaps between the dots of an ellipsis. */
export function columnGaps(inked: ArrayLike<boolean>): number[] {
  const runs = columnRuns(inked);
  return runs.slice(1).map(([start], i) => start - runs[i]![1]);
}

/** Turn a `gap` option into px, 'natural' or 'none'. */
export function resolveGap(gap: Gap, fontSize: number, dots: () => number | null): number | 'natural' | 'none' {
  if (gap === 'none' || gap === 'natural') return gap;
  if (gap === 'dots') return dots() ?? 'natural';
  if (typeof gap === 'number') return gap;
  const value = parseFloat(gap);
  if (!Number.isFinite(value)) return 'natural';
  return gap.endsWith('em') ? value * fontSize : value;
}

// ---------------------------------------------------------------------------
// Canvas measurement
//
// Browsers round glyph bounding boxes to whole pixels, which is a lot of error
// at 14px. So everything is measured at a large reference size and scaled.

const REFERENCE_SIZE = 128;

/** A font as seen by the canvas: CSS shorthand at the reference size, and the scale to the real size. */
export interface Font {
  css: string;
  scale: number;
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let ctx: Context | null = null;
const glyphCache = new Map<string, Map<string, GlyphMetrics>>();
const runCache = new Map<string, [number, number][]>();

function canvas(width: number, height: number): Context {
  const c =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
      : Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('elide: 2D canvas is not available');
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  return c;
}

function context(font: Font): Context {
  ctx ??= canvas(1, 1);
  if (ctx.font !== font.css) ctx.font = font.css;
  return ctx;
}

/** Font of a computed style. */
export function fontOf(cs: CSSStyleDeclaration): Font {
  const caps = cs.fontVariantCaps === 'small-caps' ? 'small-caps ' : '';
  return {
    css: `${cs.fontStyle} ${caps}${cs.fontWeight} ${REFERENCE_SIZE}px ${cs.fontFamily}`,
    scale: parseFloat(cs.fontSize) / REFERENCE_SIZE,
  };
}

function measureRaw(font: Font, text: string): GlyphMetrics {
  let byFont = glyphCache.get(font.css);
  if (!byFont) glyphCache.set(font.css, (byFont = new Map()));
  let m = byFont.get(text);
  if (!m) {
    const tm = context(font).measureText(text);
    m = {
      advance: tm.width,
      left: tm.actualBoundingBoxLeft,
      right: tm.actualBoundingBoxRight,
      ascent: tm.actualBoundingBoxAscent,
      descent: tm.actualBoundingBoxDescent,
    };
    byFont.set(text, m);
  }
  return m;
}

/** Metrics for `text`, without letter-spacing. */
export function measure(font: Font, text: string): GlyphMetrics {
  const m = measureRaw(font, text);
  const s = font.scale;
  return { advance: m.advance * s, left: m.left * s, right: m.right * s, ascent: m.ascent * s, descent: m.descent * s };
}

/** Advance width of `text` in a CSS `font` shorthand, in px. Not cached: for whole strings. */
export function advance(font: string, text: string): number {
  return context({ css: font, scale: 1 }).measureText(text).width;
}

/** Font ascent of the content area, used to locate the baseline in a box. */
export function fontAscent(font: Font): number {
  return context(font).measureText('x').fontBoundingBoxAscent * font.scale;
}

/**
 * The separate marks of `text` (the dots of an ellipsis) as horizontal
 * `[start, end)` spans in px from the left edge of its ink, found by drawing
 * it and scanning for empty pixel columns.
 */
export function inkRuns(font: Font, text: string): [number, number][] {
  const key = `${font.css}
${text}`;
  let runs = runCache.get(key);
  if (!runs) {
    const m = measureRaw(font, text);
    const pad = 2;
    const width = Math.ceil(m.left + m.right) + pad * 2;
    const height = Math.ceil(m.ascent + m.descent) + pad * 2;
    runs = [];
    if (width > pad * 2 && height > pad * 2) {
      const c = canvas(width, height);
      c.font = font.css;
      c.fillText(text, pad + m.left, pad + m.ascent);
      const { data } = c.getImageData(0, 0, width, height);
      const inked = Array.from({ length: width }, () => false);
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          // Half coverage approximates where the outline is.
          if (data[(y * width + x) * 4 + 3]! >= 128) {
            inked[x] = true;
            break;
          }
        }
      }
      runs = columnRuns(inked).map(([a, b]) => [a - pad, b - pad]);
    }
    runCache.set(key, runs);
  }
  return runs.map(([a, b]) => [a * font.scale, b * font.scale]);
}

/**
 * Average space between the separate marks of `text` (the dots of an
 * ellipsis). Null when it is a single mark, like '→'.
 */
export function dotSpacing(font: Font, text: string): number | null {
  const runs = inkRuns(font, text);
  if (runs.length < 2) return null;
  return (runs[runs.length - 1]![0] - runs[0]![1] - runs.slice(1, -1).reduce((s, [a, b]) => s + b - a, 0)) / (runs.length - 1);
}

/** Forget cached metrics, e.g. after web fonts finish loading. */
export function clearMetrics(): void {
  glyphCache.clear();
  runCache.clear();
}

export function applyTextTransform(text: string, transform: string): string {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  return text;
}
