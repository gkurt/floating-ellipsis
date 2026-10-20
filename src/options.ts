/** An instance's options and their defaults, and its state. */
import type { Keep, Position, Range, Snap, Whole } from './cut.ts';
import type { EllipsisStyle, Length } from './marks.ts';
import type { Chain } from './markup.ts';
import type { Gap, GapPlan } from './metrics.ts';
import type { Shorten, ShortPart } from './shorten.ts';

export interface ElideOptions {
  /**
   * What to show: a string, or a node whose text and inline elements (links,
   * code, emphasis) are shown, copied around whatever part of them shows (a
   * fragment for several). Defaults to the element's own content, read the
   * same way. Whitespace in content is collapsed.
   */
  text?: string | Node;
  /**
   * Maximum number of lines, or 'fit': as many as fit the element's height,
   * which something has to cap (`height`, `max-height`, a flex or grid track
   * with `min-height: 0`). Default 1.
   */
  lines?: number | 'fit';
  /**
   * Where the ellipsis goes: a share of the text, 'start' | 'middle' | 'end'
   * or 0..1, or on one line, a place along it for the ellipsis' middle: a
   * share of the content box's width ('50%') or a length from its start
   * ('120px', '8em'). Default 'end'. An array places several ellipses, e.g.
   * `[0.33, 0.67]`; in one with a place, a number is a share of the line too.
   */
  position?: Position | readonly Position[];
  /**
   * Parts that always stay visible: a string (first match), a RegExp (every
   * match if global, else the first) or `{ start, end }` string offsets. Text
   * hidden on both sides of a kept part gets an ellipsis on each side.
   * Earlier entries win when not all of them fit. `{ match, context: 3 }`
   * shows up to three words either side of every match, as room allows,
   * before any other text: a search result's snippet. `{ before, after }`
   * counts each side on its own: `{ after: Infinity }` shows the words after
   * a match and none before it.
   */
  keep?: Keep | readonly Keep[] | null;
  /**
   * What the ellipsis looks like: a string ('…' by default, '...', '·····')
   * or drawn marks, e.g. `{ shape: 'bullet', count: 5 }`. See `MarkStyle`.
   * An empty string or `count: 0` leaves just a balanced gap. Dots in
   * brackets ('[…]', '(…)') mark words left out of a quotation: the brackets
   * hug the dots, and the ellipsis is spaced like a word. 'auto' sets
   * Chinese and Japanese text's ellipsis in the middle of the line, on its
   * cells (see `MarkStyle.cells`), and any other text's as '…'.
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
  /**
   * Fill the room left on a line with more marks, so a lot of it (a word or
   * a path segment hidden whole) doesn't spread the marks far apart: a number
   * from 0 to 1, the share of the marks that would fit at their own spacing
   * (the ellipsis' own included) that are drawn. 1 (or true) adds one
   * wherever it fits; 0.75 lets the gaps grow a little first (3 dots stay 3
   * until 6 would fit), and a long run settles that much sparser. 0 (or
   * false) adds none. With `justify: 'dots'` every gap stays even; with
   * 'ellipsis' (or 'spread' on more than one line) the marks keep their
   * spacing and the two gaps around them take the rest; with 'spread' the
   * letters spread by what's left; with false, it stays at the end. Only
   * marks that are all the same are repeated (drawn marks, '...', and '…'
   * split into dots). Default 0.75.
   */
  repeat?: boolean | number;
  /**
   * The widest an ink gap next to or inside an ellipsis gets from justifying
   * ('dots' and 'ellipsis'): px, or a string like '0.75em'. Room past it
   * stays at the end of the line, which then isn't flush: a long word that
   * wrapped, or a snap that dropped a whole word, would otherwise spread the
   * dots far apart. Null for no limit. Default '0.75em'.
   */
  maxGap?: Length | null;
  /** Drop whitespace touching an ellipsis. Default true. */
  trim?: boolean;
  /** Move cuts to nicer boundaries: `words()`, or `separators()` for paths. */
  snap?: Snap | null;
  /**
   * Parts shown whole or not at all, never split: numbers, dates, versions,
   * hashes. A string (first match), a RegExp (every match if global) or
   * `{ start, end }` string offsets, or an array. An ellipsis that would split
   * one moves off it, hiding as much elsewhere, or hides all of it at an end.
   * Combines with `snap`. Default null.
   */
  whole?: Whole | readonly Whole[] | null;
  /**
   * Text a little too long for its lines shows whole, set tighter, rather
   * than truncated: letters closer by up to this much (px, or a string like
   * '0.02em'), and word spaces by up to twice as much. Only as much as it
   * takes, so one line ends at the edge. Truncated text is set as usual,
   * unless `tightenCuts`. Default 0: never.
   */
  tighten?: Length;
  /**
   * On one line, truncated text is set tighter too, by up to `tighten`, to show as
   * much more of the text as that makes room for. Default false.
   */
  tightenCuts?: boolean;
  /**
   * Parts that show shorter before any text is truncated: `{ match, to }` (a
   * string's first match, or every match of a global RegExp) or
   * `{ start, end, to }` (string offsets), with `to` the short form, or
   * several from longer to shorter. Forms are taken a step at a time, the
   * fewest that let the text fit: every part takes its first before any
   * takes its second, and the last entry goes first. A part showing short is
   * never split; copying, find in page, the title and screen readers get its
   * long form. Default null.
   */
  shorten?: Shorten | readonly Shorten[] | null;
  /**
   * Re-truncate when the element is resized and when web fonts load. An
   * element more than a screen away from the viewport waits until it comes
   * near, when what it shows meanwhile can't change its height. Default true.
   */
  observe?: boolean;
  /**
   * Glyph mode: `glyphs` from `floating-ellipsis/glyphs` wraps every grapheme
   * in its own element so it can be styled or animated (see
   * `floating-ellipsis/transitions`). Costs more DOM; meant for short texts.
   * Default null.
   */
  glyphs?: GlyphMode | null;
  /** Put the full text in the element's `title` while truncated or shortened. Default false. */
  title?: boolean;
  /**
   * What a copied selection contains where it crosses an ellipsis:
   * 'full' (default) the hidden text, 'visible' the ellipsis itself.
   */
  copy?: 'full' | 'visible';
  /**
   * Content that follows the text on its last line and is never truncated: a
   * "Read more" button, a badge, a timestamp. Made by `suffix()` from
   * `floating-ellipsis/suffix`. Default null.
   */
  suffix?: Suffix | null;
  /**
   * What find in page does with text an ellipsis hides. 'keep' (default):
   * finds it, and keeps the word the match starts in visible, like `keep`,
   * marked `data-fp-match`, until a press elsewhere or a match in other text.
   * 'expand': finds it, and expands the text in place (see `expand()`)
   * until then. false: doesn't find it.
   */
  find?: 'keep' | 'expand' | false;
  /**
   * For an element whose width comes from its content (an inline-block, a
   * float, a flex or grid item sized by it): `autoSize()` from
   * `floating-ellipsis/autosize` sizes it as its full text would, whatever
   * part of it shows. Default null: its width comes from what shows.
   */
  autoSize?: AutoSize | null;
}

export type Settings = Required<Omit<ElideOptions, 'text'>>;

export const DEFAULTS: Settings = {
  lines: 1,
  position: 'end',
  keep: null,
  ellipsis: '…',
  gap: 'dots',
  justify: 'dots',
  repeat: 0.75,
  maxGap: '0.75em',
  trim: true,
  snap: null,
  whole: null,
  tighten: 0,
  tightenCuts: false,
  shorten: null,
  observe: true,
  glyphs: null,
  title: false,
  copy: 'full',
  suffix: null,
  find: 'keep',
  autoSize: null,
};

/** What the `glyphs` option takes: glyph mode, from `floating-ellipsis/glyphs`. */
export interface GlyphMode {
  /** One element per grapheme, holding a copy of the unit (an image, an icon) it is, if any. */
  create(graphemes: readonly string[], units: readonly (Element | null)[]): HTMLSpanElement[];
  /**
   * Put the glyph elements of `range` in `el`, inside copies of their
   * elements; a part showing in a short form as the element `short` makes
   * for it, in place of its glyphs.
   */
  fill(
    el: HTMLElement,
    glyphs: readonly HTMLElement[],
    chains: readonly (Chain | null)[],
    range: Range,
    short: readonly ShortPart[],
    shortEl: (part: ShortPart) => Element,
  ): void;
  /** Give the glyph elements of graphemes in `ranges` `attribute`, and take it from the rest. */
  mark(glyphs: readonly HTMLElement[], attribute: string, ranges: readonly Range[]): void;
}

/** What the `suffix` option takes: made by `suffix()` from `floating-ellipsis/suffix`. */
export interface Suffix {
  /** A string, or a node, which is moved into place (and back on `destroy()`). */
  content: string | Node;
  /** When it shows: 'always', or only while the text is 'truncated'. */
  show: 'always' | 'truncated';
  /** Puts it after `host`'s line; `resized` is called when its content changes width. */
  place(host: HTMLElement, resized: () => void): SuffixSlot;
}

/** A suffix in place after the line. */
export interface SuffixSlot {
  readonly el: HTMLElement;
  fill(content: string | Node): void;
  /** Its width now, for fitting. Reads layout. */
  measure(): number;
  /**
   * Show it (`on`) or not, as a pass renders `graphemes` with `hidden` left
   * out: before the pass measures what has to fit, so content that depends
   * on the truncation (as a list's label does) is measured as it shows.
   */
  show(on: boolean, hidden: readonly Range[], graphemes: readonly string[]): void;
  /** Put a node back where it came from; one of the host's own comes back with its content on `destroy` (`destroying`). */
  giveBack(destroying: boolean): void;
}

/** What the `autoSize` option takes: made by `autoSize()` from `floating-ellipsis/autosize`. */
export interface AutoSize {
  /** Puts an invisible copy of the content in `host`, which sizes it. */
  place(host: HTMLElement): AutoSizeSlot;
}

/** The copy of an element's content that sizes it. */
export interface AutoSizeSlot {
  /** Where the instance puts the full text. */
  readonly text: HTMLElement;
  /** Copy `suffix` (a suffix's element, or null for none) after the text. */
  suffix(suffix: Element | null): void;
  remove(): void;
}

/** The share of the marks that fit that `repeat` draws, from 0 to 1. */
export const repeatRatio = (repeat: boolean | number): number =>
  typeof repeat === 'boolean' ? Number(repeat) : Number.isNaN(repeat) ? 0 : Math.min(1, Math.max(0, repeat));

/** Whether text set to `lines` can wrap: more than one line, or as many as fit. */
export const wraps = (lines: number | 'fit'): boolean => lines === 'fit' || lines > 1;

/** `o` without the keys set to undefined, so they don't override defaults. */
export function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

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
  /** The hidden parts show in place of their ellipses (see `expand()`). */
  expanded: boolean;
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
  /** How much closer `tighten` set the letters so the text fits (with `tightenCuts`, the cut too), in px; 0 when it didn't. */
  tightened: number;
  /** Some part shows in a short form (see `shorten`). */
  shortened: boolean;
  /** The parts showing in a short form, in order: `text` is the long form, `form` what shows. */
  short: ShortPart[];
}

export type ChangeReason = 'init' | 'resize' | 'update' | 'fonts' | 'refresh';

/**
 * The state of `text` (whose grapheme `i` starts at `offsets[i]`) with
 * `hidden` left out and `pins` kept.
 */
export function stateOf(
  text: string,
  offsets: readonly number[],
  cut: {
    hidden: readonly Range[];
    pins: readonly Range[];
    lines: number;
    gaps: GapInfo[];
    slack: number;
    expanded: boolean;
    tightened: number;
    short: readonly ShortPart[];
  },
): ElideState {
  const part = ([start, end]: Range): Part => ({ start, end, text: text.slice(offsets[start], offsets[end]) });
  const { hidden, pins, lines, gaps, slack, expanded, tightened, short } = cut;
  return {
    text,
    length: offsets.length - 1,
    truncated: hidden.length > 0,
    expanded,
    hidden: hidden.map(part),
    kept: hidden.length > 0 ? pins.map(part) : [],
    lines,
    gaps,
    slack,
    tightened,
    ...shownShort(short, hidden),
  };
}

/** The parts of `short` showing, with none of them in a part of `hidden`. */
function shownShort(short: readonly ShortPart[], hidden: readonly Range[]): Pick<ElideState, 'short' | 'shortened'> {
  const shown = short.filter((p) => !hidden.some(([s, e]) => s <= p.start && p.end <= e));
  return { shortened: shown.length > 0, short: shown };
}

/** Whether grapheme `i` is showing in `state`. */
export function isVisible(state: ElideState, i: number): boolean {
  for (const h of state.hidden) if (i >= h.start && i < h.end) return false;
  return true;
}
