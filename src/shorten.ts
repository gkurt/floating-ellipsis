/**
 * Short forms (`shorten`): parts of the text that show shorter, a step at a
 * time, before any of it is truncated. Which parts there are, the order they
 * shorten in, and what shows at each level. DOM-free.
 */
import { type Range, asArray, matches, toGraphemeRanges } from './cut.ts';
import type { Part } from './options.ts';

/**
 * A part that may show shorter: found as `keep` finds one (the first match
 * of a string, every match of a global RegExp, or string offsets), and what
 * it shows instead, longest first: one form, or several to step through.
 */
export type Shorten =
  | { match: string | RegExp; to: string | readonly string[] }
  | { start: number; end: number; to: string | readonly string[] };

/** A part that may show shorter: its graphemes, and its forms, longest first. */
export interface Form {
  start: number;
  end: number;
  to: readonly string[];
}

/** A part showing in a short form: `text` is what it stands for, `form` what shows. */
export interface ShortPart extends Part {
  form: string;
}

/**
 * The parts `entries` find in `text` (whose grapheme `i` starts at
 * `offsets[i]`), in the order given. One that overlaps a part found before
 * it is left out.
 */
export function formsOf(text: string, offsets: readonly number[], entries: readonly Shorten[]): Form[] {
  const forms: Form[] = [];
  for (const entry of entries) {
    const to = asArray<string>(entry.to);
    if (to.length === 0) continue;
    const found = 'match' in entry ? matches(text, { match: entry.match }) : matches(text, { start: entry.start, end: entry.end });
    for (const [start, end] of toGraphemeRanges(found, offsets)) {
      if (start >= end || forms.some((f) => f.start < end && start < f.end)) continue;
      forms.push({ start, end, to });
    }
  }
  return forms;
}

/**
 * The order `forms` shorten in, one step each (the index of the form that
 * takes its next form): every form takes its first before any takes its
 * second, and within a round the last given goes first, so the list reads
 * from most to least important, as `keep`'s does. Forms `long` says stay
 * long take no steps.
 */
export function stepsOf(forms: readonly Form[], long: (form: Form) => boolean = () => false): number[] {
  const steps: number[] = [];
  const deepest = forms.reduce((most, f) => Math.max(most, f.to.length), 0);
  for (let d = 0; d < deepest; d++)
    for (let f = forms.length - 1; f >= 0; f--) if (forms[f]!.to.length > d && !long(forms[f]!)) steps.push(f);
  return steps;
}

/** What shows short once the first `level` of `steps` are taken, in order through the text. */
export function shortAt(
  text: string,
  offsets: readonly number[],
  forms: readonly Form[],
  steps: readonly number[],
  level: number,
): ShortPart[] {
  const depth = new Int32Array(forms.length);
  for (let i = 0; i < level && i < steps.length; i++) depth[steps[i]!]!++;
  const out: ShortPart[] = [];
  forms.forEach(({ start, end, to }, f) => {
    if (depth[f]! > 0) out.push({ start, end, text: text.slice(offsets[start], offsets[end]), form: to[depth[f]! - 1]! });
  });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Running totals over `n` graphemes: `each(i)` for a grapheme as itself,
 * and for a part of `short`, `form(part)` on its first grapheme and nothing
 * on the rest (`short` in order, as `shortAt` gives it).
 */
export function totals(
  n: number,
  each: (i: number) => number,
  short: readonly ShortPart[],
  form: (part: ShortPart) => number,
): Float64Array {
  const out = new Float64Array(n + 1);
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < short.length && short[k]!.end <= i) k++;
    const part = short[k];
    const inPart = part !== undefined && i >= part.start;
    out[i + 1] = out[i]! + (!inPart ? each(i) : i === part.start ? form(part) : 0);
  }
  return out;
}

/** The ranges of `short`, for keeping each whole. */
export const shortRanges = (short: readonly ShortPart[]): Range[] => short.map((p): Range => [p.start, p.end]);

/** Graphemes `[from, to)` of `g` as they show, each part of `short` (which the range doesn't split) in its short form. */
export function shownText(g: readonly string[], short: readonly ShortPart[], from: number, to: number): string {
  let out = '';
  let i = from;
  for (const part of short) {
    if (part.end <= from || part.start >= to) continue;
    out += g.slice(i, Math.max(i, part.start)).join('') + part.form;
    i = Math.max(i, part.end);
  }
  return out + g.slice(i, to).join('');
}
