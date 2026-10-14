import { isWhitespace } from './graphemes.js';

/** Visible text is graphemes `[0, start)` + ellipsis + `[end, length)`. */
export interface Cut {
  start: number;
  end: number;
}

export interface SnapContext {
  graphemes: readonly string[];
  /** Raw cut chosen by the fitting search. */
  start: number;
  end: number;
  /** Requested ellipsis position, 0 (start) to 1 (end). */
  position: number;
}

/**
 * Moves a raw cut to a nicer place. It may only hide more text, never less:
 * the result must satisfy `start <= ctx.start` and `end >= ctx.end`.
 */
export type Snap = (ctx: SnapContext) => Cut;

export type Position = number | 'start' | 'middle' | 'end';

export function positionValue(p: Position): number {
  if (p === 'start') return 0;
  if (p === 'middle') return 0.5;
  if (p === 'end') return 1;
  return Math.min(1, Math.max(0, p));
}

/**
 * Keep `kept` graphemes, split between head and tail by `position`.
 * Both head and tail lengths are non-decreasing in `kept`, so growing the
 * budget only ever reveals glyphs next to the ellipsis.
 */
export function rawCut(length: number, kept: number, position: number): Cut {
  const head = Math.round(kept * position);
  return { start: head, end: length - (kept - head) };
}

export function refineCut(
  graphemes: readonly string[],
  raw: Cut,
  position: number,
  snap: Snap | null,
  trim: boolean,
): Cut {
  let { start, end } = raw;
  if (snap) {
    const s = snap({ graphemes, start, end, position });
    start = Math.min(start, Math.max(0, s.start));
    end = Math.max(end, Math.min(graphemes.length, s.end));
  }
  if (trim) {
    while (start > 0 && isWhitespace(graphemes[start - 1])) start--;
    while (end < graphemes.length && isWhitespace(graphemes[end])) end++;
  }
  return { start, end: Math.max(start, end) };
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

/**
 * Experimental smart boundaries: cut right after a separator on the head side
 * and right before one on the tail side, so `/abc/def/ghi/jkl` becomes
 * `/abc/…/jkl` rather than `/abc/de…/jkl`. A side with no separator in reach
 * falls back to the plain cut. `separators(' ')` gives word boundaries.
 */
export function separators(chars: string | RegExp = '/\\'): Snap {
  const re = typeof chars === 'string' ? null : new RegExp(chars.source, chars.flags.replace(/[gy]/g, ''));
  const isSep = (g: string | undefined) => g !== undefined && (re ? re.test(g) : (chars as string).includes(g));
  return ({ graphemes: g, start, end }) => {
    let s = start;
    while (s > 0 && !isSep(g[s - 1])) s--;
    if (s === 0) s = start;
    let e = end;
    while (e < g.length && !isSep(g[e])) e++;
    if (e === g.length) e = end;
    return { start: s, end: e };
  };
}
