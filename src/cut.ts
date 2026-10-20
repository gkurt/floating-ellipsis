import { isIdeograph, isWhitespace } from './graphemes.ts';

/** Grapheme range `[start, end)`. */
export type Range = readonly [start: number, end: number];

/** One cut: graphemes `[start, end)` are replaced by an ellipsis. */
export interface Cut {
  start: number;
  end: number;
}

export interface SnapContext {
  graphemes: readonly string[];
  /** Raw range the fitting search wants to hide. */
  start: number;
  end: number;
  /** Requested position of this ellipsis, 0 (start) to 1 (end). */
  position: number;
  /** Where the cut may move without running into the cuts either side: `[min, max)`. */
  min: number;
  max: number;
  /**
   * Where the cut may start and end so as not to split a whole (see
   * `ElideOptions.whole`), or undefined for anywhere. A cut that splits one
   * anyway is widened to hide all of it.
   */
  edges?: Edges | null;
}

/**
 * Moves a cut to a nicer place. It may hide more or less than `ctx`'s range,
 * but should show about as much in all: the search for the largest cut that
 * fits relies on what's shown growing as `ctx`'s range shrinks.
 */
export type Snap = (ctx: SnapContext) => Cut;

// ---------------------------------------------------------------------------
// Edges
//
// Snapping to words and keeping parts whole are the same thing: rules for
// where a cut may start and end. `words()` lets one start where a word
// starts and end where one ends; `whole` lets one start and end anywhere but
// inside its matches. Rules combine by both holding, and one search
// (`shortestRun`) finds the run that keeps to them nearest the cut.

/** Where a cut may start and end: edge `i` is just before grapheme `i`. */
export interface Edges {
  start(i: number): boolean;
  end(i: number): boolean;
}

/** Edges at the boundaries of segments, which separators part: a cut starts where one begins, and ends where one ends. */
export function segmentEdges(isSep: (i: number) => boolean): Edges {
  return { start: (i) => !isSep(i) && isSep(i - 1), end: (i) => !isSep(i - 1) && isSep(i) };
}

/** Edges anywhere but inside `wholes` (grapheme ranges), so no cut splits one; null with none. */
export function wholeEdges(n: number, wholes: readonly Range[]): Edges | null {
  if (wholes.length === 0) return null;
  const inside = new Uint8Array(n + 1);
  for (const [s, e] of wholes) inside.fill(1, Math.max(0, s + 1), Math.min(n + 1, e));
  const at = (i: number) => inside[i] !== 1;
  return { start: at, end: at };
}

/** The edges both `a` and `b` allow (either may be null, for anywhere). */
export function bothEdges(a: Edges, b: Edges | null | undefined): Edges {
  return b ? { start: (i) => a.start(i) && b.start(i), end: (i) => a.end(i) && b.end(i) } : a;
}

/** `cuts` widened until none splits a whole (`edges`), never into `pins`. */
export function widen(n: number, cuts: readonly Range[], edges: Edges, pins: readonly Range[]): Range[] {
  const pinned = (i: number) => pins.some(([a, b]) => i >= a && i < b);
  return union(
    cuts.map(([s, e]): Range => {
      while (s > 0 && !edges.start(s) && !pinned(s - 1)) s--;
      while (e < n && !edges.end(e) && !pinned(e)) e++;
      return [s, e];
    }),
  );
}

/** Where an ellipsis goes as a share of the text: 0 (the start) to 1 (the end). */
export type Share = number | 'start' | 'middle' | 'end';

/**
 * Where an ellipsis' middle goes along the line: a share of the content
 * box's width (`'50%'`), or how far from its start (`'120px'`, `'8em'`).
 */
export type Place = `${number}%` | `${number}px` | `${number}em`;

export type Position = Share | Place;

/** Whether `p` is a place along the line, not a share of the text. */
export const isPlace = (p: Position): p is Place => typeof p === 'string' && /\d(%|px|em)$/.test(p);

const isList = <T>(v: T | readonly T[]): v is readonly T[] => Array.isArray(v);

/** One option value or several, as a list. */
export const asArray = <T>(v: T | readonly T[] | null | undefined): readonly T[] => (v == null ? [] : isList(v) ? v : [v]);

/** `p` as a share, 0 to 1: of the text, or for a place, of the line (a length: its middle, until it's placed). */
export function positionValue(p: Position): number {
  if (p === 'start') return 0;
  if (p === 'middle') return 0.5;
  if (p === 'end') return 1;
  if (typeof p === 'string') return p.endsWith('%') ? Math.min(1, Math.max(0, parseFloat(p) / 100)) : 0.5;
  return Math.min(1, Math.max(0, p));
}

/**
 * Where the middle of each ellipsis goes on a line from `left` to `right`,
 * whose room ends at `end`, for an ellipsis `size` wide with its gaps, in
 * order: a length from `left` (`em` px to an em), or a share of the line
 * (a '%' place, and a share of the text alongside places), each as far in as
 * the ellipsis needs.
 */
export function placesOf(positions: readonly Position[], left: number, right: number, end: number, size: number, em: number): number[] {
  return positions
    .map((p) => {
      const at =
        isPlace(p) && !p.endsWith('%')
          ? left + parseFloat(p) * (p.endsWith('em') ? em : 1)
          : left + size / 2 + positionValue(p) * (right - left - size);
      return Math.max(left + size / 2, Math.min(end - size / 2, at));
    })
    .sort((a, b) => a - b);
}

/**
 * The islands for ellipses at `places` along a line from `left` to `right`
 * (see `placesOf`): each but the last as long as `fits(i, start, end)` says
 * graphemes [start, end) fit before place `i` (and after place `i - 1`),
 * the first from the start and the ones between centred where they sit in
 * the text, apart from the island before; the last takes the rest. So the
 * search, filling them in turn, only looks for how much of the end fits.
 */
export function placedLayout(
  n: number,
  places: readonly number[],
  left: number,
  right: number,
  fits: (i: number, start: number, end: number) => boolean,
): Layout {
  const positions = places.map((x) => (right > left ? Math.min(1, Math.max(0, (x - left) / (right - left))) : 0.5));
  const sizes: number[] = [];
  let before = 0;
  positions.forEach((p, i) => {
    const center = i === 0 ? 0 : (n * (positions[i - 1]! + p)) / 2;
    const startOf = (size: number) => (i === 0 ? 0 : Math.min(n - size, Math.max(0, Math.round(center - size / 2))));
    const room = (size: number) => (i === 0 || startOf(size) > before) && fits(i, startOf(size), startOf(size) + size);
    let size = 0;
    while (size < n - before && room(size + 1)) size++;
    sizes.push(size);
    if (size > 0) before = startOf(size) + size;
  });
  const order = new Int32Array(n);
  let k = 0;
  sizes.forEach((size, i) => order.fill(i, k, (k += size)));
  order.fill(places.length, k);
  const counts = Array.from({ length: places.length + 1 }, () => 0);
  for (const i of order) counts[i]!++;
  const steps = counts.map((count) => new Int32Array(count));
  counts.fill(0);
  order.forEach((i, step) => (steps[i]![counts[i]!++] = step));
  return { length: n, positions, order, steps };
}

// ---------------------------------------------------------------------------
// Islands
//
// With m ellipses at positions p1 <= ... <= pm, the kept text forms m + 1
// islands: the first anchored at the start, the last at the end, and the
// ones in between centred where they sit in the full text. Island i gets the
// share (p[i] - p[i-1]) of the kept graphemes.

export interface Layout {
  length: number;
  positions: number[];
  /** Island receiving each successive kept grapheme. */
  order: Int32Array;
  /** For each island, the steps of `order` that give it a grapheme, in order. */
  steps: Int32Array[];
}

/**
 * Hand out `units` one at a time to the island furthest behind its share.
 * Every island's size only ever grows with the budget, and the islands
 * take turns, so widening reveals one glyph at a time.
 */
export function allocationOrder(weights: readonly number[], units: number): Int32Array {
  const order = new Int32Array(units);
  const given = Array.from({ length: weights.length }, () => 0);
  for (let k = 1; k <= units; k++) {
    let best = 0;
    let most = -Infinity;
    for (let i = 0; i < weights.length; i++) {
      const behind = weights[i]! * k - given[i]!;
      if (behind > most + 1e-9) {
        best = i;
        most = behind;
      }
    }
    given[best]!++;
    order[k - 1] = best;
  }
  return order;
}

export function layoutFor(length: number, positions: readonly Position[]): Layout {
  const p = (positions.length > 0 ? positions : ['end' as const]).map(positionValue).sort((a, b) => a - b);
  const weights = p.map((v, i) => v - (i > 0 ? p[i - 1]! : 0));
  weights.push(1 - p[p.length - 1]!);
  const order = allocationOrder(weights, length);
  const counts = weights.map(() => 0);
  for (const i of order) counts[i]!++;
  const steps = counts.map((count) => new Int32Array(count));
  counts.fill(0);
  order.forEach((i, k) => (steps[i]![counts[i]!++] = k));
  return { length, positions: p, order, steps };
}

/** How many of `steps` (sorted) come before `kept`. */
function before(steps: Int32Array, kept: number): number {
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid]! < kept) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The visible islands when `kept` graphemes are shown. */
export function islands(layout: Layout, kept: number): Range[] {
  const { length: n, positions: p, steps } = layout;
  const m = p.length;
  const sizes = steps.map((s) => before(s, kept));
  const out: Range[] = [[0, sizes[0]!]];
  for (let i = 1; i < m; i++) {
    const size = sizes[i]!;
    const center = (n * (p[i - 1]! + p[i]!)) / 2;
    const start = Math.min(n - size, Math.max(0, Math.round(center - size / 2)));
    out.push([start, start + size]);
  }
  out.push([n - sizes[m]!, n]);
  return out.filter(([s, e]) => e > s);
}

/**
 * `pins` less the one to give way when they can't all fit: the last, unless
 * it holds `first`, which gives way only once it's all that's left.
 */
export function giveWay(pins: readonly Range[], first: Range | null): Range[] {
  const holds = (p: Range) => !!first && p[0] <= first[0] && p[1] >= first[1];
  let i = pins.length - 1;
  while (i > 0 && holds(pins[i]!)) i--;
  return pins.filter((_, k) => k !== i);
}

/** Sorted, merged copy of `ranges` (touching ranges merge too). */
export function union(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** What `ranges` leave uncovered in `[0, length)`. */
export function complement(length: number, ranges: readonly Range[]): Range[] {
  const out: Range[] = [];
  let at = 0;
  for (const [s, e] of union(ranges)) {
    if (s > at) out.push([at, s]);
    at = Math.max(at, e);
  }
  if (at < length) out.push([at, length]);
  return out;
}

/** `ranges` minus `cutouts`. */
export function subtract(ranges: readonly Range[], cutouts: readonly Range[]): Range[] {
  const holes = union(cutouts);
  const out: Range[] = [];
  for (const [s, e] of union(ranges)) {
    let at = s;
    for (const [hs, he] of holes) {
      if (he <= at || hs >= e) continue;
      if (hs > at) out.push([at, hs]);
      at = Math.max(at, he);
    }
    if (at < e) out.push([at, e]);
  }
  return out;
}

/** Everything that decides where a text is cut, but how much of it is kept. */
export interface Cutting {
  graphemes: readonly string[];
  layout: Layout;
  /** Parts that always show. */
  pins: readonly Range[];
  snap: Snap | null;
  trim: boolean;
  /** Where cuts may start and end so as not to split a whole (see `wholeEdges`); null for anywhere. */
  wholes: Edges | null;
  /** Context that shows around kept parts before the islands get any (see `contextOf`); null for none. */
  context: ContextSteps | null;
}

/** The most graphemes a cut can keep (see `hiddenRanges`): one short of all, and the context on top. */
export const maxKept = (c: Cutting): number => c.graphemes.length - 1 + (c.context?.costs.at(-1) ?? 0);

/**
 * What shows with `kept` graphemes to give out: context, word by word, the
 * next word as much of it as they reach from its part (unless it takes a
 * whole), and once it's all showing, the islands.
 */
function shownFor(c: Cutting, kept: number): Range[] {
  const context = c.context;
  if (!context) return islands(c.layout, kept);
  const { steps, costs, after, entire } = context;
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (costs[mid]! <= kept) lo = mid + 1;
    else hi = mid;
  }
  const shown = steps.slice(0, lo);
  if (lo === steps.length) {
    shown.push(...islands(c.layout, kept - (costs.at(-1) ?? 0)));
    return shown;
  }
  const left = kept - (costs[lo - 1] ?? 0);
  if (left > 0 && entire[lo] === 0) {
    const [s, e] = steps[lo]!;
    shown.push(after[lo] === 1 ? [s, Math.min(e, s + left)] : [Math.max(s, e - left), e]);
  }
  return shown;
}

/**
 * The ranges to hide when `kept` graphemes go to the context and the
 * islands, and the pins always stay visible. Snapping and whitespace
 * trimming grow the hidden ranges; pins are carved back out last, so they
 * always win. Slivers left between a pin and the text around it are shown
 * (see `showSlivers`). No cut splits a whole.
 */
export function hiddenRanges(c: Cutting, kept: number): Range[] {
  const { graphemes, layout, pins, snap, trim, wholes } = c;
  const n = graphemes.length;
  const raw = complement(n, [...shownFor(c, kept), ...pins]);
  const m = layout.positions.length;
  const grown = raw.map(([s, e], j): Range => {
    const min = raw[j - 1]?.[1] ?? 0;
    const max = raw[j + 1]?.[0] ?? n;
    const r = snap
      ? snap({ graphemes, start: s, end: e, position: layout.positions[Math.min(j, m - 1)]!, min, max, edges: wholes })
      : wholes && shortestRun(wholes, n, s, e, min, max);
    if (r) {
      const rs = Math.max(0, r.start);
      const re = Math.min(n, r.end);
      if (rs < re) [s, e] = [rs, re];
    }
    if (trim) {
      while (s > 0 && isWhitespace(graphemes[s - 1])) s--;
      while (e < n && isWhitespace(graphemes[e])) e++;
    }
    return [s, e];
  });
  const cuts = showSlivers(graphemes, subtract(grown, pins), pins);
  return wholes ? widen(n, cuts, wholes, pins) : cuts;
}

/**
 * The most graphemes `hiddenRanges` can keep while their widths (`sums` is
 * their running total: `sums[i]` is the width of graphemes [0, i)), with
 * `mark` for each cut, add up to no more than `room`. Only an estimate of
 * what fits, as layout will tell, but a cheap one. A `hint` near the
 * answer makes it cheaper still.
 */
export function estimateKept(c: Cutting, sums: ArrayLike<number>, mark: number, room: number, hint?: number): number {
  return searchMax(0, maxKept(c), (k) => keptWidth(sums, mark, hiddenRanges(c, k)) <= room, hint);
}

/** How text wraps, for `wrapsInto`: lines `width` wide, at most `lines` of them, and whether a line break in the text starts a line. */
export interface Wrapping {
  width: number;
  lines: number;
  breaks: boolean;
}

/**
 * Whether the graphemes `hidden` leaves (`sums`: as for `estimateKept`) fit
 * `wrap`, set as a browser sets them one line after another: words go on
 * the line they fit on, or start the next; spaces hang past the edge; a
 * line break starts a line (with `wrap.breaks`); Chinese and Japanese
 * characters break anywhere, and a word wider than a line does too. Each cut
 * shows as `marks[j]` (its ellipsis and the room around it), joined to the
 * words either side, and `end` (a suffix) joins the last word.
 */
export function wrapsInto(
  graphemes: readonly string[],
  sums: ArrayLike<number>,
  hidden: readonly Range[],
  marks: readonly number[],
  wrap: Wrapping,
  end = 0,
): boolean {
  const { width, lines } = wrap;
  if (!(width > 0)) return false;
  let line = 1;
  let x = 0;
  let word = 0;
  let j = 0;
  /** Set `w` (a word, or what breaks around itself) where it fits. */
  const place = (w: number) => {
    word = 0;
    if (w === 0) return;
    if (x > 0 && x + w > width) {
      line++;
      x = 0;
    }
    const over = Math.max(0, Math.ceil(w / width) - 1);
    line += over;
    x += w - over * width;
  };
  for (let i = 0; i < graphemes.length && line <= lines; i++) {
    const cut = hidden[j];
    if (cut?.[0] === i) {
      word += marks[j++] ?? 0;
      i = cut[1] - 1;
      continue;
    }
    const g = graphemes[i]!;
    const w = sums[i + 1]! - sums[i]!;
    if (!isWhitespace(g) && !isIdeograph(g)) {
      word += w;
      continue;
    }
    place(word);
    if (g === '\n' && wrap.breaks) {
      line++;
      x = 0;
    } else if (isWhitespace(g)) {
      x += w;
    } else {
      place(w);
    }
  }
  if (j < hidden.length) word += marks[j] ?? 0;
  place(word + end);
  return line <= lines;
}

/**
 * `estimateKept` on more than one line: the most graphemes `hiddenRanges`
 * can keep while `wrapsInto` says they fit, `marks(hidden)` giving each cut's
 * width. A longer cut can fit where a shorter one doesn't (a word that
 * wrapped moves back up), so the search can find one of several answers:
 * which it finds depends only on what's passed.
 */
export function estimateWrapped(
  c: Cutting,
  sums: ArrayLike<number>,
  marks: (hidden: readonly Range[]) => readonly number[],
  wrap: Wrapping,
  end: number,
): number {
  return searchMax(0, maxKept(c), (k) => {
    const hidden = hiddenRanges(c, k);
    return wrapsInto(c.graphemes, sums, hidden, marks(hidden), wrap, end);
  });
}

/** The width of the graphemes `hidden` leaves (`sums`: as for `estimateKept`), with `mark` for each cut. */
export function keptWidth(sums: ArrayLike<number>, mark: number, hidden: readonly Range[]): number {
  let w = sums[sums.length - 1]!;
  for (const [s, e] of hidden) w -= sums[e]! - sums[s]! - mark;
  return w;
}

/**
 * Characters (code units) showing with `hidden` cut, each cut showing
 * `marks` instead; at least one. `offsets[i]` is where grapheme `i` starts.
 */
export function shownLength(offsets: readonly number[], hidden: readonly Range[], marks: number): number {
  let n = offsets[offsets.length - 1]!;
  for (const [s, e] of hidden) n += marks - (offsets[e]! - offsets[s]!);
  return Math.max(1, n);
}

/** Whether two lists of ranges are the same. */
export function sameRanges(a: readonly Range[], b: readonly Range[]): boolean {
  return a.length === b.length && a.every((r, i) => r[0] === b[i]![0] && r[1] === b[i]![1]);
}

/** Most graphemes (whitespace aside) a cut beside a pin can hide and still be a sliver. */
export const SLIVER = 3;

/**
 * A cut next to a pin that hides only a sliver (`SLIVER` graphemes or fewer,
 * whitespace aside), like `brow…fox` for `brown fox`, just puts a second
 * ellipsis around it. Show those instead, and to keep the line about as long,
 * hide as many more graphemes at the edges of the nearest other cut
 * (preferring one that doesn't touch a pin), one side then the other, never
 * into a pin.
 */
export function showSlivers(graphemes: readonly string[], cuts: readonly Range[], pins: readonly Range[]): Range[] {
  if (pins.length === 0) return [...cuts];
  const n = graphemes.length;
  const byPin = ([s, e]: Range) => pins.some(([a, b]) => b === s || a === e);
  const pinned = (i: number) => pins.some(([a, b]) => i >= a && i < b);
  const sliver = (cut: Range) => {
    if (!byPin(cut)) return false;
    let count = 0;
    for (let i = cut[0]; i < cut[1] && count <= SLIVER; i++) if (!isWhitespace(graphemes[i])) count++;
    return count <= SLIVER;
  };
  const kept = cuts.filter((c) => !sliver(c)).map(([s, e]): [number, number] => [s, e]);
  for (const cut of cuts) {
    if (!sliver(cut)) continue;
    // Pay for it at the nearest other cut, one not beside a pin if there is one.
    const distance = (c: Range) => (c[0] >= cut[1] ? c[0] - cut[1] : cut[0] - c[1]);
    const rank = (c: Range) => (byPin(c) ? n : 0) + distance(c);
    let best: [number, number] | null = null;
    for (const c of kept) if (!best || rank(c) < rank(best)) best = c;
    // With no other cut to pay at, it's the line's only ellipsis: keep it.
    if (!best) {
      kept.push([cut[0], cut[1]]);
      continue;
    }
    let owed = cut[1] - cut[0];
    let end = true;
    while (owed > 0) {
      const canEnd = best[1] < n && !pinned(best[1]);
      const canStart = best[0] > 0 && !pinned(best[0] - 1);
      if (!canEnd && !canStart) break;
      if (end ? canEnd : !canStart) best[1]++;
      else best[0]--;
      end = !end;
      owed--;
    }
  }
  return union(kept);
}

/**
 * Largest k in [lo, hi] for which `fits(k)` holds, assuming `fits` is
 * monotone (true up to some k, false after) and `fits(lo)` is true.
 * A `hint` (e.g. the previous answer) turns small changes into a few probes.
 */
export function searchMax(lo: number, hi: number, fits: (k: number) => boolean, hint?: number | null): number {
  const search = searchSteps(lo, hi, hint);
  let step = search.next();
  while (!step.done) step = search.next(fits(step.value));
  return step.value;
}

/**
 * `searchMax` one probe at a time: yields each k to try, takes whether it
 * fits, and returns the answer. Lets the caller do other work between probes.
 */
export function* searchSteps(lo: number, hi: number, hint?: number | null): Generator<number, number, boolean> {
  if (hi <= lo) return lo;
  if (hint != null) {
    const h = Math.min(hi, Math.max(lo, hint));
    let step = 1;
    if (yield h) {
      lo = h;
      while (lo < hi) {
        const next = Math.min(hi, lo + step);
        if (!(yield next)) {
          hi = next - 1;
          break;
        }
        lo = next;
        step *= 2;
      }
    } else {
      hi = h - 1;
      while (hi > lo) {
        const next = Math.max(lo, hi - step + 1);
        if (yield next) {
          lo = next;
          break;
        }
        hi = next - 1;
        step *= 2;
      }
    }
  }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (yield mid) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** What trying a k told: whether it fits, and how much room it left (negative: lacked), when that's known. */
export interface Tried {
  fits: boolean;
  room: number | null;
}

/**
 * `searchSteps` steered by how much room each probe left or lacked: the
 * next probe goes where `aim(k, room)` (the most that the room `k` left
 * holds) says the answer is, or rather one past it, so that when the aim is
 * true the last probe is the answer. Probes either side still pin it down.
 * Without a room to aim by, and after a few aims, it goes on as
 * `searchSteps` does: steps doubling away from the last probe until one
 * turns, then halving. `fits(lo)` is assumed, as for `searchMax`.
 */
export function* steeredSteps(
  lo: number,
  hi: number,
  first: number | null,
  aim: (k: number, room: number) => number,
): Generator<number, number, Tried> {
  let next = first ?? (lo + hi + 1) >> 1;
  let aims = 0;
  // The way steps go (1 up, -1 down, 0 none yet), how far the next goes, and whether one turned.
  let way = 0;
  let stride = 1;
  let turned = false;
  while (lo < hi) {
    const k = Math.min(hi, Math.max(lo + 1, next));
    const { fits, room } = yield k;
    if (fits) lo = k;
    else hi = k - 1;
    if (room === null || aims >= AIMS) {
      const going = fits ? 1 : -1;
      turned ||= way !== 0 && going !== way;
      way = going;
      next = turned ? (lo + hi + 1) >> 1 : k + going * stride;
      stride *= 2;
      continue;
    }
    aims++;
    next = aim(k, room) + 1;
    // Past the bracket: its edge is the answer if anything is.
    if (next > hi) next = hi;
  }
  return lo;
}

/** Aimed probes before `steeredSteps` falls back to halving. */
const AIMS = 4;

export interface SeparatorOptions {
  /**
   * A cut usually starts inside one segment and stops inside another. Rather
   * than drop both partial segments (and leave a wide gap), one of them may
   * keep a fragment of at least `min` graphemes. `'head'` prefers the
   * beginning of the segment the cut starts in, with the ellipsis at its end:
   * `/abc/de…/klm`. `'tail'` prefers the end of the segment the cut stops in:
   * `/abc/…hj/klm`. Either falls back to the other side when its own has no
   * room. `false` always drops whole segments: `/abc/…/klm`. Default `'head'`
   * for `separators`, `false` for `words`.
   */
  fragment?: 'head' | 'tail' | false;
  /** Fewest graphemes of a segment worth showing as a fragment. Default 3. */
  min?: number;
}

/** Whether grapheme `i` separates segments, for a text's graphemes. */
type Separating = (graphemes: readonly string[]) => (i: number) => boolean;

/**
 * Cut at separators, so `/abc/def/ghi/jkl` becomes `/abc/de…/jkl` or
 * `/abc/…/jkl` rather than `/abc/de…hi/jkl`. `chars` are the separators:
 * a string of them, or a RegExp a separator grapheme matches.
 *
 * Each side of the cut moves to a separator. At most one side keeps a
 * fragment of its segment, and that fragment takes the glyphs the other side
 * gave up, so the cut shows about as much as the plain one. A side with no
 * separator in reach keeps the plain cut and is the fragment. Where whole
 * segments go instead, it's the shortest run of them that hides enough, so
 * the room left over (which justifying spreads into the gaps) stays small.
 * Separators next to the cut stay visible.
 */
export function separators(chars: string | RegExp = '/\\', options: SeparatorOptions = {}): Snap {
  const re = typeof chars === 'string' ? null : new RegExp(chars.source, chars.flags.replace(/[gy]/g, ''));
  const test = (g: string) => (re ? re.test(g) : typeof chars === 'string' && chars.includes(g));
  return segmentSnap((g) => (i) => test(g[i]!), { fragment: 'head', ...options });
}

const wordIds = new WeakMap<readonly string[], Int32Array>();
let wordSegmenter: Intl.Segmenter | null | undefined;
const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;

/**
 * Cut at word boundaries: `The quick brown fox` becomes `The quick…fox`,
 * never `The qui…own fox`. Words come from `Intl.Segmenter`, so languages
 * written without spaces split into words too. Whole words go by default,
 * the shortest run of them that hides enough; `fragment` lets one side keep
 * part of a word instead, as with `separators`.
 */
export function words(options: SeparatorOptions = {}): Snap {
  return segmentSnap(wordGapsOf, { fragment: false, ...options });
}

/** Which graphemes are outside words (spaces, punctuation), by index. */
function wordGapsOf(g: readonly string[]): (i: number) => boolean {
  const ids = wordsOf(g);
  return (i) => ids[i]! < 0;
}

/**
 * The word each grapheme is in, numbered from 0 in order, or -1 outside
 * words (spaces, punctuation). Words come from `Intl.Segmenter`, so text
 * written without spaces splits into words too. Cached for `g`.
 */
export function wordsOf(g: readonly string[]): Int32Array {
  let ids = wordIds.get(g);
  if (ids) return ids;
  if (wordSegmenter === undefined)
    wordSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  ids = new Int32Array(g.length).fill(-1);
  if (wordSegmenter) {
    // Grapheme `i` starts at string offset `offsets[i]`.
    const offsets: number[] = [];
    let at = 0;
    for (const s of g) {
      offsets.push(at);
      at += s.length;
    }
    let i = 0;
    let word = 0;
    for (const { index, segment, isWordLike } of wordSegmenter.segment(g.join(''))) {
      while (i < g.length && offsets[i]! < index) i++;
      for (; i < g.length && offsets[i]! < index + segment.length; i++) if (isWordLike) ids[i] = word;
      if (isWordLike) word++;
    }
  } else {
    let word = 0;
    g.forEach((s, i) => {
      if (WORD_CHAR.test(s)) ids[i] = word;
      else if (i > 0 && ids[i - 1]! >= 0) word++;
    });
  }
  wordIds.set(g, ids);
  return ids;
}

/** The whole word grapheme `i` is in, given `wordsOf`; just `i` outside words. */
export function wordAround(ids: Int32Array, i: number): Range {
  const id = ids[i]!;
  if (id < 0) return [i, i + 1];
  let s = i;
  let e = i + 1;
  while (s > 0 && ids[s - 1] === id) s--;
  while (e < ids.length && ids[e] === id) e++;
  return [s, e];
}

/**
 * How many graphemes a cut may move for each grapheme of room it saves:
 * `shortestRun` takes a run further away only when it leaves less room.
 */
const DRIFT = 6;

/**
 * The run from an edge a cut may start at to one it may end at (`edges`)
 * that hides at least as many graphemes as `[start, end)` and leaves the
 * least room over, counting each `DRIFT` graphemes it moves away from the
 * cut as one more. With segment edges, that's the fewest whole segments that
 * hide enough; with a whole's, the cut slides off it rather than grow. It
 * stays within `[min, max)`. A cut at an end of the text stays there, and
 * one that isn't never takes that end, so no island disappears. Null when
 * there's no such run.
 */
export function shortestRun(edges: Edges, n: number, start: number, end: number, min = 0, max = n): Cut | null {
  const need = end - start;
  const starts: number[] = [];
  const ends: number[] = [];
  if (start === 0) starts.push(0);
  else for (let i = Math.max(1, min); i < max; i++) if (edges.start(i)) starts.push(i);
  if (end === n) ends.push(n);
  else for (let i = min + 1; i <= Math.min(max, n - 1); i++) if (edges.end(i)) ends.push(i);
  let best: Cut | null = null;
  let lowest = Infinity;
  let k = 0;
  for (const s of starts) {
    // Both are sorted: the first end far enough only moves right, and for a
    // given start it's the best end (going further leaves more room).
    while (k < ends.length && ends[k]! < s + need) k++;
    const e = ends[k];
    if (e === undefined) break;
    const cost = e - s - need + Math.abs(s + e - start - end) / 2 / DRIFT;
    if (cost < lowest) {
      best = { start: s, end: e };
      lowest = cost;
    }
  }
  return best;
}

/** A snap that moves cuts to the boundaries of segments, which `separating` tells apart. */
function segmentSnap(separating: Separating, options: SeparatorOptions): Snap {
  const { fragment = 'head', min = 3 } = options;
  return ({ graphemes: g, start, end, min: low, max: high, edges: wholes }) => {
    const n = g.length;
    const sep = separating(g);
    const isSep = (i: number) => i >= 0 && i < n && sep(i);
    // Whole segments, none of them inside a whole.
    const edges = bothEdges(segmentEdges(isSep), wholes);
    // The head's segment runs from `h0` to the separator at `h1`; the tail's
    // from just after the separator at `t0 - 1` to `t1`.
    let h0 = start;
    while (h0 > 0 && !isSep(h0 - 1)) h0--;
    let h1 = start;
    while (h1 < n && !isSep(h1)) h1++;
    let t0 = end;
    while (t0 > 0 && !isSep(t0 - 1)) t0--;
    let t1 = end;
    while (t1 < n && !isSep(t1)) t1++;

    // Already at a separator; or not cut at all.
    const headClean = start === h0;
    const tailClean = end === t1;

    const place = (giveBack: boolean): Cut & { whole?: Cut } => {
      // A separator right at the cut can stay visible, which makes that side clean.
      const headBack = giveBack && !headClean && isSep(start);
      const tailBack = giveBack && !tailClean && isSep(end - 1);
      // No separator in reach: the plain cut stays, as this side's fragment.
      const headForced = !headClean && !headBack && h0 === 0;
      const tailForced = !tailClean && !tailBack && t1 === n;
      if (headForced && tailForced) return { start, end };

      // Each side at its separator.
      let s = headClean || headForced ? start : headBack ? start + 1 : h0;
      let e = tailClean || tailForced ? end : tailBack ? end - 1 : t1;
      // What each side gives up by moving.
      const headLoss = Math.max(0, start - s);
      const tailLoss = Math.max(0, e - end);

      // Which side keeps a fragment, if any.
      let side: 'head' | 'tail' | null = null;
      if (headForced || tailForced) {
        side = headForced && !tailForced ? 'head' : !headForced && tailForced ? 'tail' : null;
      } else {
        const headRoom = s === h0 && start - h0 + tailLoss >= min;
        const tailRoom = e === t1 && t1 - end + headLoss >= min;
        const order = fragment === 'head' ? (['head', 'tail'] as const) : fragment === 'tail' ? (['tail', 'head'] as const) : [];
        side = order.find((x) => (x === 'head' ? headRoom : tailRoom)) ?? null;
        // Both sides at separators: whole segments go, as few as hide what
        // the cut does, separators given back at its edges aside.
        if (!side) return { start: s, end: e, whole: { start: headBack ? start + 1 : start, end: tailBack ? end - 1 : end } };
      }

      // The fragment grows by what the other side gave up, through as many
      // segments as that takes. Wherever it ends, the same rules apply: a
      // separator there stays visible, and less than `min` of a segment
      // isn't worth showing.
      if (side === 'head') {
        s = Math.min(start + tailLoss, e - 1);
        if (s >= h1 && isSep(s) && s + 1 < e) {
          s++;
        } else if (s > h1) {
          let s0 = s;
          while (!isSep(s0 - 1)) s0--;
          if (s - s0 < min) s = s0;
        }
      } else if (side === 'tail') {
        e = Math.max(end - headLoss, s + 1);
        if (e <= t0 && isSep(e - 1) && e - 1 > s) {
          e--;
        } else if (e < t0) {
          let e1 = e;
          while (!isSep(e1)) e1++;
          if (e1 - e < min) e = e1;
        }
      }
      return { start: s, end: e };
    };
    if (fragment === false) {
      // Separators at the cut's edges stay visible when there's more to hide,
      // unless the cut takes the start or end of the text: it keeps it.
      const from = start > 0 && isSep(start) && start + 1 < end ? start + 1 : start;
      const to = end < n && isSep(end - 1) && end - 1 > from ? end - 1 : end;
      const fewest = shortestRun(edges, n, from, to, low, high);
      if (fewest) return fewest;
    }
    // Unless showing that separator leaves nothing to hide.
    for (const giveBack of [true, false]) {
      const cut = place(giveBack);
      if (cut.start >= cut.end) continue;
      const { whole } = cut;
      const fewest = whole && whole.start < whole.end ? shortestRun(edges, n, whole.start, whole.end, low, high) : null;
      return fewest ?? { start: cut.start, end: cut.end };
    }
    return { start, end };
  };
}

// ---------------------------------------------------------------------------
// Kept parts

/**
 * A part to keep visible: the first match of a string, every match of a
 * global RegExp (else the first), or string offsets. The object forms can
 * give it a `class` too, to highlight it, and `context`: how many words
 * either side of it show (as room allows, a word at a time around every
 * match) before the text the ellipses are placed in; `Infinity` for as many
 * as fit. `{ before, after }` counts each side on its own, a side left out
 * showing none.
 */
export type Keep =
  | string
  | RegExp
  | { match: string | RegExp; class?: string; context?: KeepContext }
  | { start: number; end: number; class?: string; context?: KeepContext };

/** Words of context around a kept part: as many either side, or each side's own. */
export type KeepContext = number | { before?: number; after?: number };

/** How many words of context a kept part gets before it and after it. */
export interface Around {
  before: number;
  after: number;
}

/** A part to show whole or not at all (see `ElideOptions.whole`): found as a `Keep` is. */
export type Whole = string | RegExp | { start: number; end: number };

/** String ranges of one `keep` entry's matches. */
export function matches(text: string, k: Keep): Range[] {
  if (typeof k === 'object' && !(k instanceof RegExp) && !('match' in k))
    return k.end > k.start ? [[Math.max(0, k.start), Math.min(text.length, k.end)]] : [];
  const m = typeof k === 'string' || k instanceof RegExp ? k : k.match;
  if (typeof m === 'string') {
    const at = m ? text.indexOf(m) : -1;
    return at >= 0 ? [[at, at + m.length]] : [];
  }
  if (m.global || m.sticky) {
    const re = new RegExp(m.source, m.flags.includes('g') ? m.flags : m.flags + 'g');
    return [...text.matchAll(re)].filter((x) => x[0]).map((x): Range => [x.index, x.index + x[0].length]);
  }
  const x = m.exec(text);
  return x?.[0] ? [[x.index, x.index + x[0].length]] : [];
}

/** String ranges of the parts to keep, in the order given. */
export function keepRanges(text: string, keep: readonly Keep[]): Range[] {
  return keep.flatMap((k) => matches(text, k));
}

/** String ranges `keep` gives context, with how many words before and after them. */
export function keepContexts(text: string, keep: readonly Keep[]): [Range, Around][] {
  return keep.flatMap((k) => {
    const c = typeof k === 'object' && !(k instanceof RegExp) ? k.context : undefined;
    if (c === undefined) return [];
    const around = typeof c === 'number' ? { before: c, after: c } : { before: c.before ?? 0, after: c.after ?? 0 };
    return around.before > 0 || around.after > 0 ? matches(text, k).map((r): [Range, Around] => [r, around]) : [];
  });
}

/** Context around kept parts, in the order it shows. */
export interface ContextSteps {
  /** What each step shows: a word and what's between it and the part, after it or before. */
  steps: Range[];
  /** How many graphemes that weren't showing the steps up to each show. */
  costs: Int32Array;
  /** Which way each step reads from its part: 1 after it, 0 before it. */
  after: Uint8Array;
  /** Steps that show whole or not at all: those that take a whole. */
  entire: Uint8Array;
}

/**
 * The context `parts` (grapheme ranges, with words before and after) get as
 * room grows, for those of them still in `pins` (the rest gave way): a word
 * at a time, after each part and then before it, round after round, so every
 * match gets a word of context before any gets two; a side out of words
 * leaves the room to the other. A part cut inside a word first gets the rest
 * of it. A side that comes to a whole (`wholes`) waits while the others take
 * their words, then takes it entire as one step. Context that runs into other
 * context or a pin costs nothing more, and the windows merge. Null with none.
 */
export function contextOf(
  g: readonly string[],
  parts: readonly (readonly [Range, Around])[],
  pins: readonly Range[],
  wholes: Edges | null = null,
): ContextSteps | null {
  const live = parts.filter(([[s, e]]) => pins.some(([a, b]) => a <= s && e <= b));
  if (live.length === 0) return null;
  const n = g.length;
  const ids = wordsOf(g);
  const shown = new Uint8Array(n);
  for (const [s, e] of pins) shown.fill(1, s, e);
  const steps: Range[] = [];
  const costs: number[] = [];
  const after: number[] = [];
  const entire: number[] = [];
  let total = 0;
  const take = (s: number, e: number, isAfter: boolean, isEntire: boolean) => {
    for (let i = s; i < e; i++) {
      if (shown[i] === 1) continue;
      shown[i] = 1;
      total++;
    }
    steps.push([s, e]);
    costs.push(total);
    after.push(isAfter ? 1 : 0);
    entire.push(isEntire ? 1 : 0);
  };
  // `waitAfter` and `waitBefore`: where the step a side waits on, to take a whole, would end or start; -1 for none.
  const windows = live.map(([[s, e], { before, after }]) => ({ s, e, before, after, waitAfter: -1, waitBefore: -1 }));
  type Window = (typeof windows)[number];
  const stepAfter = (w: Window): boolean => {
    if (w.after <= 0 || w.waitAfter >= 0) return false;
    let i = w.e;
    while (i < n && ids[i]! < 0) i++;
    if (i === n) {
      w.after = 0;
      return false;
    }
    let end = wordAround(ids, i)[1];
    if (wholes && !wholes.end(end)) {
      while (end < n && !wholes.end(end)) end++;
      w.waitAfter = end;
      return false;
    }
    take(w.e, end, true, false);
    w.e = end;
    w.after--;
    return true;
  };
  const stepBefore = (w: Window): boolean => {
    if (w.before <= 0 || w.waitBefore >= 0) return false;
    let i = w.s - 1;
    while (i >= 0 && ids[i]! < 0) i--;
    if (i < 0) {
      w.before = 0;
      return false;
    }
    let start = wordAround(ids, i)[0];
    if (wholes && !wholes.start(start)) {
      while (start > 0 && !wholes.start(start)) start--;
      w.waitBefore = start;
      return false;
    }
    take(start, w.s, false, false);
    w.s = start;
    w.before--;
    return true;
  };
  for (;;) {
    for (let more = true; more;) {
      more = false;
      for (const w of windows) {
        if (stepAfter(w)) more = true;
        if (stepBefore(w)) more = true;
      }
    }
    const waiting = windows.filter((w) => w.waitAfter >= 0 || w.waitBefore >= 0);
    if (waiting.length === 0) break;
    for (const w of waiting) {
      if (w.waitAfter >= 0) {
        take(w.e, w.waitAfter, true, true);
        w.e = w.waitAfter;
        w.waitAfter = -1;
        w.after--;
      }
      if (w.waitBefore >= 0) {
        take(w.waitBefore, w.s, false, true);
        w.s = w.waitBefore;
        w.waitBefore = -1;
        w.before--;
      }
    }
  }
  return steps.length > 0 ? { steps, costs: Int32Array.from(costs), after: Uint8Array.from(after), entire: Uint8Array.from(entire) } : null;
}

/** String ranges `keep` gives a class, with the class. */
export function keepClasses(text: string, keep: readonly Keep[]): [Range, string][] {
  return keep.flatMap((k) => {
    const cls = typeof k === 'object' && !(k instanceof RegExp) ? k.class : undefined;
    return cls ? matches(text, k).map((r): [Range, string] => [r, cls]) : [];
  });
}

/**
 * The classes of each grapheme, from string ranges with a class each:
 * space-separated where they overlap, null where there's none.
 * `offsets[i]` is where grapheme `i` starts (length n + 1).
 */
export function graphemeClasses(classes: readonly [Range, string][], offsets: readonly number[]): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: offsets.length - 1 }, () => null);
  for (const [range, cls] of classes)
    for (const [s, e] of toGraphemeRanges([range], offsets)) for (let i = s; i < e; i++) out[i] = out[i] ? `${out[i]} ${cls}` : cls;

  return out;
}

/** Map string ranges to grapheme ranges, given grapheme start offsets (length n + 1). */
export function toGraphemeRanges(ranges: readonly Range[], offsets: readonly number[]): Range[] {
  const index = (offset: number, roundUp: boolean) => {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid]! < offset) lo = mid + 1;
      else hi = mid;
    }
    // `lo` is the first grapheme starting at or after `offset`.
    return roundUp || offsets[lo] === offset ? lo : lo - 1;
  };
  return union(ranges.map(([s, e]): Range => [index(s, false), index(e, true)]));
}
