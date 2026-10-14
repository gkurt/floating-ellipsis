/** An instance's options and their defaults, its state, and its change events. */
import type { Keep, Position, Snap } from './cut.ts';
import type { EllipsisStyle } from './marks.ts';
import type { Gap, GapPlan } from './metrics.ts';

export interface ElideOptions {
  /** Text to show. Defaults to the element's text content (whitespace collapsed). */
  text?: string;
  /** Maximum number of lines. Default 1. */
  lines?: number;
  /**
   * Where the ellipsis goes: 'start' | 'middle' | 'end' or 0..1. Default 'end'.
   * An array places several ellipses, e.g. `[0.33, 0.67]`.
   */
  position?: Position | Position[];
  /**
   * Parts that always stay visible: a string (first match), a RegExp (every
   * match if global, else the first) or `{ start, end }` string offsets. Text
   * hidden on both sides of a kept part gets an ellipsis on each side.
   * Earlier entries win when not all of them fit.
   */
  keep?: Keep | Keep[] | null;
  /**
   * What the ellipsis looks like: a string ('…' by default, '...', '·····')
   * or drawn marks, e.g. `{ shape: 'bullet', count: 5 }`. See `MarkStyle`.
   * An empty string or `count: 0` leaves just a balanced gap.
   */
  ellipsis?: EllipsisStyle;
  /**
   * Ink gap on both sides of the ellipsis:
   * - 'dots' (default): same as the space between the ellipsis' own marks
   * - 'natural': average of the font's natural gaps, so the total width is kept
   * - 'none': leave spacing alone
   * - a px number, or a string like '0.12em' / '2px'
   */
  gap?: Gap;
  /**
   * Make every line holding an ellipsis end exactly at the edge of the
   * available area, so resizing flows smoothly instead of stepping a glyph
   * at a time:
   * - 'dots' (default): the slack evens out every gap, so text, marks and
   *   text again are all equally spaced. A single glyph like '…' is redrawn
   *   as separate dots shaped like its own.
   * - 'ellipsis': the slack goes into the two gaps around the ellipsis,
   *   equally. The dots keep their spacing and float between the text.
   * - 'spread': the slack is spread over the line as letter-spacing, like
   *   justified text. Single-line only; otherwise behaves like 'ellipsis'.
   * - false: leave the slack at the end of the line.
   */
  justify?: 'ellipsis' | 'dots' | 'spread' | false;
  /** Drop whitespace touching an ellipsis. Default true. */
  trim?: boolean;
  /** Experimental: move cuts to nicer boundaries, see `separators()`. */
  snap?: Snap | null;
  /** Re-truncate when the element is resized. Default true. */
  observe?: boolean;
  /**
   * Wrap every grapheme in its own element so it can be styled or animated
   * (see `floating-ellipsis/transitions`). Costs more DOM; meant for short texts.
   */
  glyphs?: boolean;
  /** Put the full text in the element's `title` while truncated. Default false. */
  title?: boolean;
  /**
   * What a copied selection contains where it crosses an ellipsis:
   * 'full' (default) the hidden text, 'visible' the ellipsis itself.
   */
  copy?: 'full' | 'visible';
  /** Shorthand for `instance.onChange(fn)`. */
  onChange?: (change: ElideChange) => void;
}

export type Settings = Required<Omit<ElideOptions, 'text' | 'onChange'>>;

export const DEFAULTS: Settings = {
  lines: 1,
  position: 'end',
  keep: null,
  ellipsis: '…',
  gap: 'dots',
  justify: 'dots',
  trim: true,
  snap: null,
  observe: true,
  glyphs: false,
  title: false,
  copy: 'full',
};

/** A stretch of text, by grapheme index. */
export interface Part {
  start: number;
  end: number;
  text: string;
}

/** Spacing around one ellipsis. All gaps are ink to ink, in px. */
export interface GapInfo extends GapPlan {
  /** Final gap left of the ellipsis (null = no glyph there). */
  left: number | null;
  /** Final gap right of the ellipsis (null = no glyph there). */
  right: number | null;
  /** Final gaps between the ellipsis' marks. */
  inner: number[];
  /** Space this ellipsis took in from justification. */
  slack: number;
}

export interface ElideState {
  text: string;
  /** Number of graphemes in `text`. */
  length: number;
  truncated: boolean;
  /** The hidden parts, one per ellipsis, in order. */
  hidden: Part[];
  /** Kept parts (from `keep`) that are showing while truncated. */
  kept: Part[];
  /** Rendered line count. */
  lines: number;
  /** Spacing around each ellipsis. */
  gaps: GapInfo[];
  /**
   * Room that was left on the lines holding ellipses before justification
   * took it in, in px. Small values mean the text is tightly packed.
   */
  slack: number;
}

export type ChangeReason = 'init' | 'resize' | 'update' | 'fonts' | 'refresh';

export interface ElideChange {
  reason: ChangeReason;
  state: ElideState;
  previous: ElideState | null;
  /** The text (or glyph mode) changed, so indices in `previous` don't map onto `state`. */
  reset: boolean;
  /** Grapheme indices that became visible. */
  shown: number[];
  /** Grapheme indices that became hidden. */
  hidden: number[];
  /** Glyph mode only: box and ink box of each newly hidden glyph as last painted. */
  hiddenGlyphs: Map<number, { box: DOMRect; ink: DOMRect }>;
  /** Glyph mode only: box and ink box of every glyph that was showing, as last painted. */
  glyphsBefore: Map<number, { box: DOMRect; ink: DOMRect }>;
  /** Mark boxes of each ellipsis just before the update. */
  marksBefore: DOMRect[][];
}

/** Whether two lists of parts cover the same graphemes. */
export function sameParts(a: readonly Part[], b: readonly Part[]): boolean {
  return a.length === b.length && a.every((p, i) => p.start === b[i]!.start && p.end === b[i]!.end);
}

/** Whether grapheme `i` is showing in `state`. */
export function isVisible(state: ElideState, i: number): boolean {
  for (const h of state.hidden) if (i >= h.start && i < h.end) return false;
  return true;
}
