import { isWhitespace } from './graphemes.js';

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
}

/**
 * Moves a cut to a nicer place. It may hide more or less than `ctx`'s range,
 * but should show about as much in all: the search for the largest cut that
 * fits relies on what's shown growing as `ctx`'s range shrinks.
 */
export type Snap = (ctx: SnapContext) => Cut;

export type Position = number | 'start' | 'middle' | 'end';

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
  const given = new Array<number>(weights.length).fill(0);
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
  const p = (positions.length ? positions : ['end' as const]).map(positionValue).sort((a, b) => a - b);
  const weights = p.map((v, i) => v - (i ? p[i - 1]! : 0));
  weights.push(1 - p[p.length - 1]!);
  return { length, positions: p, order: allocationOrder(weights, length) };
}

/** The visible islands when `kept` graphemes are shown. */
export function islands(layout: Layout, kept: number): Range[] {
  const { length: n, positions: p, order } = layout;
  const m = p.length;
  const sizes = new Array<number>(m + 1).fill(0);
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
 * ranges; pins are carved back out last, so they always win.
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
      const r = snap({ graphemes, start: s, end: e, position: layout.positions[Math.min(j, m - 1)]! });
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
  return subtract(grown, pins);
}

/**
 * Largest k in [lo, hi] for which `fits(k)` holds, assuming `fits` is
 * monotone (true up to some k, false after) and `fits(lo)` is true.
 * A `hint` (e.g. the previous answer) turns small changes into a few probes.
 */
export function searchMax(lo: number, hi: number, fits: (k: number) => boolean, hint?: number | null): number {
  if (hi <= lo) return lo;
  if (hint != null) {
    const h = Math.min(hi, Math.max(lo, hint));
    let step = 1;
    if (fits(h)) {
      lo = h;
      while (lo < hi) {
        const next = Math.min(hi, lo + step);
        if (!fits(next)) { hi = next - 1; break; }
        lo = next;
        step *= 2;
      }
    } else {
      hi = h - 1;
      while (hi > lo) {
        const next = Math.max(lo, hi - step + 1);
        if (fits(next)) { lo = next; break; }
        hi = next - 1;
        step *= 2;
      }
    }
  }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(mid)) lo = mid;
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
   * room. `false` always drops whole segments: `/abc/…/klm`. Default `'head'`.
   */
  fragment?: 'head' | 'tail' | false;
  /** Fewest graphemes of a segment worth showing as a fragment. Default 3. */
  min?: number;
}

/**
 * Experimental smart boundaries: cut at separators, so `/abc/def/ghi/jkl`
 * becomes `/abc/de…/jkl` or `/abc/…/jkl` rather than `/abc/de…hi/jkl`.
 *
 * Each side of the cut moves to a separator, which hides a little more than
 * the plain cut would. At most one side keeps a fragment of its segment
 * instead, and that fragment takes the glyphs the other side gave up, so the
 * cut shows about as much as the plain one and leaves no wide gap. A side with
 * no separator in reach keeps the plain cut and is the fragment. Separators
 * next to the cut stay visible. `separators(' ')` gives word boundaries.
 */
export function separators(chars: string | RegExp = '/\\', options: SeparatorOptions = {}): Snap {
  const { fragment = 'head', min = 3 } = options;
  const re = typeof chars === 'string' ? null : new RegExp(chars.source, chars.flags.replace(/[gy]/g, ''));
  const isSep = (g: string | undefined) => g !== undefined && (re ? re.test(g) : (chars as string).includes(g));
  return ({ graphemes: g, start, end }) => {
    const n = g.length;
    // The head's segment runs from `h0` to the separator at `h1`; the tail's
    // from just after the separator at `t0 - 1` to `t1`.
    let h0 = start;
    while (h0 > 0 && !isSep(g[h0 - 1])) h0--;
    let h1 = start;
    while (h1 < n && !isSep(g[h1])) h1++;
    let t0 = end;
    while (t0 > 0 && !isSep(g[t0 - 1])) t0--;
    let t1 = end;
    while (t1 < n && !isSep(g[t1])) t1++;

    // Already at a separator; or not cut at all.
    const headClean = start === h0;
    const tailClean = end === t1;

    const place = (giveBack: boolean): Cut => {
      // A separator right at the cut can stay visible, which makes that side clean.
      const headBack = giveBack && !headClean && isSep(g[start]);
      const tailBack = giveBack && !tailClean && isSep(g[end - 1]);
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
      if (headForced || tailForced) side = headForced && !tailForced ? 'head' : !headForced && tailForced ? 'tail' : null;
      else {
        const headRoom = s === h0 && start - h0 + tailLoss >= min;
        const tailRoom = e === t1 && t1 - end + headLoss >= min;
        const order = fragment === 'head' ? (['head', 'tail'] as const) : fragment === 'tail' ? (['tail', 'head'] as const) : [];
        side = order.find((x) => (x === 'head' ? headRoom : tailRoom)) ?? null;
      }

      // The fragment grows by what the other side gave up, through as many
      // segments as that takes. Wherever it ends, the same rules apply: a
      // separator there stays visible, and less than `min` of a segment
      // isn't worth showing.
      if (side === 'head') {
        s = Math.min(start + tailLoss, e - 1);
        if (s >= h1 && isSep(g[s]) && s + 1 < e) s++;
        else if (s > h1) {
          let s0 = s;
          while (!isSep(g[s0 - 1])) s0--;
          if (s - s0 < min) s = s0;
        }
      } else if (side === 'tail') {
        e = Math.max(end - headLoss, s + 1);
        if (e <= t0 && isSep(g[e - 1]) && e - 1 > s) e--;
        else if (e < t0) {
          let e1 = e;
          while (!isSep(g[e1])) e1++;
          if (e1 - e < min) e = e1;
        }
      }
      return { start: s, end: e };
    };
    // Unless showing that separator leaves nothing to hide.
    for (const cut of [place(true), place(false)]) if (cut.start < cut.end) return cut;
    return { start, end };
  };
}

// ---------------------------------------------------------------------------
// Kept parts

export type Keep = string | RegExp | { start: number; end: number };

/**
 * String ranges of the parts to keep: the first match of a string, every
 * match of a global RegExp (else the first), or explicit string offsets.
 */
export function keepRanges(text: string, keep: readonly Keep[]): Range[] {
  const out: Range[] = [];
  for (const k of keep) {
    if (typeof k === 'string') {
      const at = k ? text.indexOf(k) : -1;
      if (at >= 0) out.push([at, at + k.length]);
    } else if (k instanceof RegExp) {
      if (k.global || k.sticky) {
        const re = new RegExp(k.source, k.flags.includes('g') ? k.flags : k.flags + 'g');
        for (const m of text.matchAll(re)) if (m[0]) out.push([m.index, m.index + m[0].length]);
      } else {
        const m = k.exec(text);
        if (m?.[0]) out.push([m.index, m.index + m[0].length]);
      }
    } else if (k.end > k.start) {
      out.push([Math.max(0, k.start), Math.min(text.length, k.end)]);
    }
  }
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
