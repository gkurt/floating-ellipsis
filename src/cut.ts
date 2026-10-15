import { isWhitespace } from './graphemes.ts';

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
}

/**
 * Moves a cut to a nicer place. It may hide more or less than `ctx`'s range,
 * but should show about as much in all: the search for the largest cut that
 * fits relies on what's shown growing as `ctx`'s range shrinks.
 */
export type Snap = (ctx: SnapContext) => Cut;

export type Position = number | 'start' | 'middle' | 'end';

const isList = <T>(v: T | readonly T[]): v is readonly T[] => Array.isArray(v);

/** One option value or several, as a list. */
export const asArray = <T>(v: T | readonly T[] | null | undefined): readonly T[] => (v == null ? [] : isList(v) ? v : [v]);

export function positionValue(p: Position): number {
  if (p === 'start') return 0;
  if (p === 'middle') return 0.5;
  if (p === 'end') return 1;
  return Math.min(1, Math.max(0, p));
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
  return { length, positions: p, order: allocationOrder(weights, length) };
}

/** The visible islands when `kept` graphemes are shown. */
export function islands(layout: Layout, kept: number): Range[] {
  const { length: n, positions: p, order } = layout;
  const m = p.length;
  const sizes = Array.from({ length: m + 1 }, () => 0);
  for (let k = 0; k < Math.min(kept, order.length); k++) sizes[order[k]!]!++;
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

/**
 * The ranges to hide when `kept` graphemes go to the islands and `pins`
 * always stay visible. Snapping and whitespace trimming grow the hidden
 * ranges; pins are carved back out last, so they always win. Slivers left
 * between a pin and the text around it are shown (see `showSlivers`).
 */
export function hiddenRanges(
  graphemes: readonly string[],
  layout: Layout,
  kept: number,
  pins: readonly Range[],
  snap: Snap | null,
  trim: boolean,
): Range[] {
  const n = graphemes.length;
  const raw = complement(n, [...islands(layout, kept), ...pins]);
  const m = layout.positions.length;
  const grown = raw.map(([s, e], j): Range => {
    if (snap) {
      const min = raw[j - 1]?.[1] ?? 0;
      const max = raw[j + 1]?.[0] ?? n;
      const r = snap({ graphemes, start: s, end: e, position: layout.positions[Math.min(j, m - 1)]!, min, max });
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
  return showSlivers(graphemes, subtract(grown, pins), pins);
}

/**
 * The most graphemes `hiddenRanges` can keep while their widths (`sums` is
 * their running total: `sums[i]` is the width of graphemes [0, i)), with
 * `mark` for each cut, add up to no more than `room`. Only an estimate of
 * what fits, as layout will tell, but a cheap one.
 */
export function estimateKept(
  graphemes: readonly string[],
  layout: Layout,
  pins: readonly Range[],
  snap: Snap | null,
  trim: boolean,
  sums: ArrayLike<number>,
  mark: number,
  room: number,
): number {
  const n = graphemes.length;
  const width = (k: number) => {
    let w = sums[n]!;
    for (const [s, e] of hiddenRanges(graphemes, layout, k, pins, snap, trim)) w -= sums[e]! - sums[s]! - mark;
    return w;
  };
  return searchMax(0, n - 1, (k) => width(k) <= room);
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
  const n = graphemes.length;
  const byPin = ([s, e]: Range) => pins.some(([a, b]) => b === s || a === e);
  const pinned = (i: number) => pins.some(([a, b]) => i >= a && i < b);
  const sliver = (cut: Range) => {
    let count = 0;
    for (let i = cut[0]; i < cut[1]; i++) if (!isWhitespace(graphemes[i])) count++;
    return byPin(cut) && count <= SLIVER;
  };
  const kept = cuts.filter((c) => !sliver(c)).map(([s, e]): [number, number] => [s, e]);
  for (const cut of cuts) {
    if (!sliver(cut)) continue;
    // Pay for it at the nearest other cut, one not beside a pin if there is one.
    const distance = (c: Range) => (c[0] >= cut[1] ? c[0] - cut[1] : cut[0] - c[1]);
    const rank = (c: Range) => (byPin(c) ? n : 0) + distance(c);
    let best: [number, number] | null = null;
    for (const c of kept) if (!best || rank(c) < rank(best)) best = c;
    if (!best) continue;
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
 * `fewestSegments` takes a run further away only when it leaves less room.
 */
const DRIFT = 6;

/**
 * The run of whole segments, from a segment's start to a segment's end, that
 * hides at least as many graphemes as `[start, end)` and leaves the least
 * room over, counting each `DRIFT` graphemes it moves away from the cut as
 * one more. It stays within `[min, max)`. A cut at an end of the text stays
 * there, and one that isn't never takes that end, so no island disappears.
 * Null when there's no such run.
 */
export function fewestSegments(isSep: (i: number) => boolean, n: number, start: number, end: number, min = 0, max = n): Cut | null {
  const need = end - start;
  const starts: number[] = [];
  const ends: number[] = [];
  if (start === 0) starts.push(0);
  else for (let i = Math.max(1, min); i < max; i++) if (!isSep(i) && isSep(i - 1)) starts.push(i);
  if (end === n) ends.push(n);
  else for (let i = min + 1; i <= Math.min(max, n - 1); i++) if (!isSep(i - 1) && isSep(i)) ends.push(i);
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
  return ({ graphemes: g, start, end, min: low, max: high }) => {
    const n = g.length;
    const sep = separating(g);
    const isSep = (i: number) => i >= 0 && i < n && sep(i);
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
      const fewest = fewestSegments(isSep, n, from, to, low, high);
      if (fewest) return fewest;
    }
    // Unless showing that separator leaves nothing to hide.
    for (const giveBack of [true, false]) {
      const cut = place(giveBack);
      if (cut.start >= cut.end) continue;
      const { whole } = cut;
      const fewest = whole && whole.start < whole.end ? fewestSegments(isSep, n, whole.start, whole.end, low, high) : null;
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
 * give it a `class` too, to highlight it.
 */
export type Keep = string | RegExp | { match: string | RegExp; class?: string } | { start: number; end: number; class?: string };

/** String ranges of one `keep` entry's matches. */
function matches(text: string, k: Keep): Range[] {
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
