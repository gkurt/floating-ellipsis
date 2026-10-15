/**
 * Filling the lines that hold ellipses: each line's slack goes into its
 * ellipses' gaps (or into letter-spacing), so the line ends at the edge.
 */
import type { LineBox } from './lines.ts';
import type { Phase } from './lockstep.ts';
import type { MarkLayout } from './marks.ts';
import type { GapPlan } from './metrics.ts';
import type { ElideOptions, GapInfo } from './options.ts';

/** The rendered text being justified. */
export interface Justified {
  mode: ElideOptions['justify'];
  /** How many lines the text is on. Filling a line mustn't change it. */
  lines: number;
  /**
   * Filling a line short of the edge can't change where lines break: one
   * line that can't wrap, or lines broken one after another, the way text
   * usually is. It needs no checking then.
   */
  sure: boolean;
  /** The widest a gap may get, in px, or null. */
  maxGap: number | null;
  /** The right edge of the content box. */
  right: number;
  layout: MarkLayout;
  /** The gaps planned for each ellipsis, as rendered. */
  plans: GapPlan[];
  /** Characters on the line, for a first guess at letter-spacing. */
  characters: number;
  /**
   * Where the line ends is known without reading layout (one line that can't
   * wrap, judged rather than measured): `boxes` and `lineOf` don't read.
   */
  known: boolean;
  /** Reads layout: the lines, the line ellipsis `j` is on, and whether the text fits. */
  boxes: () => LineBox[];
  lineOf: (j: number, boxes: LineBox[]) => number;
  fits: () => { ok: boolean; lines: number };
  /** Writes: margins around and inside ellipsis `j`, or extra letter-spacing for the line. */
  space: (j: number, left: number, right: number, inner: readonly number[]) => void;
  spread: (extra: number) => void;
}

/**
 * Stretch every line holding an ellipsis so it ends exactly at the right
 * edge, putting that line's slack into its ellipses. Lines are done top to
 * bottom; filling a line up to the edge keeps its line break where it was.
 * A pass (see `lockstep`): it starts out reading.
 */
export function* justify(t: Justified, phase: Phase): Generator<void, { gaps: GapInfo[]; slack: number }, void> {
  const { layout, plans, right: edge, maxGap } = t;
  const cap = maxGap ?? Infinity;
  const info = (plan: GapPlan, left: number, right: number, inner: readonly number[], extra: number, slack: number): GapInfo => ({
    ...plan,
    left: plan.naturalLeft === null ? null : plan.naturalLeft + left + extra,
    right: plan.naturalRight === null ? null : plan.naturalRight + right + extra,
    inner: layout.natural.map((v, i) => v + (inner[i] ?? 0) + extra),
    slack,
  });
  const infos = plans.map((p) => info(p, p.marginLeft, p.marginRight, layout.inner, 0, 0));

  // Group the ellipses by line, and total the room they could take in.
  if (!t.known) yield* phase.read();
  const boxes = t.boxes();
  const byLine = new Map<number, number[]>();
  plans.forEach((_, j) => {
    const line = t.lineOf(j, boxes);
    if (line >= 0) byLine.set(line, [...(byLine.get(line) ?? []), j]);
  });
  let room = 0;
  for (const line of byLine.keys()) room += Math.max(0, edge - boxes[line]!.right);
  const mode = t.mode;
  if (mode === undefined || mode === false || room <= 0) return { gaps: infos, slack: room };

  const holds = (line: number, ellipses: number[]) => {
    const m = t.fits();
    if (!m.ok || m.lines !== t.lines) return false;
    const now = t.boxes();
    return ellipses.every((j) => t.lineOf(j, now) === line);
  };
  // Layout snaps each inline piece to 1/64 px, so filling a line exactly
  // can tip it over and wrap. Stay a hair inside, backing off if needed.
  // A sure line stays a quarter pixel inside, more than the rounding adds
  // up to, and needn't be checked.
  const insets = t.sure ? [0.25] : [1 / 16, 0.25, 1];

  if (mode === 'spread' && t.lines === 1) {
    // Letter-spacing goes after every character; drawn marks get the same
    // as margins. Measure how the line grows rather than count characters.
    // Firefox rounds letter-spacing to 1/60 px, so it is snapped down to
    // that, and what that leaves over goes into the ellipses' gaps.
    const snap = (ls: number) => Math.floor(ls * 60 + 1e-6) / 60;
    const sidesOf = (p: GapPlan) => (p.naturalLeft !== null ? 1 : 0) + (p.naturalRight !== null ? 1 : 0);
    const sides = plans.reduce((sum, p) => sum + sidesOf(p), 0);
    const margins = (p: GapPlan, ls: number, rest: number) => {
      const each = sidesOf(p) > 0 ? rest / sides : 0;
      return {
        left: p.marginLeft + (p.naturalLeft !== null ? each : 0),
        right: p.marginRight + (p.naturalRight !== null ? each : 0) + (layout.drawn ? ls : 0),
        inner: layout.drawn ? layout.inner.map((v) => v + ls) : layout.inner,
      };
    };
    const apply = (ls: number, rest: number) => {
      t.spread(ls);
      plans.forEach((p, j) => {
        const m = margins(p, ls, rest);
        t.space(j, m.left, m.right, m.inner);
      });
    };
    const start = boxes[0]!.right;
    for (const inset of insets) {
      const slack = room - inset;
      if (slack <= 0) break;
      const probe = snap(slack / Math.max(1, t.characters));
      let grown = 0;
      if (probe > 0) {
        yield* phase.write();
        apply(probe, 0);
        yield* phase.read();
        grown = (t.boxes()[0]?.right ?? start) - start;
      }
      const ls = grown > 0 ? snap((probe * slack) / grown) : 0;
      const rest = sides > 0 ? slack - (grown > 0 ? (grown * ls) / probe : 0) : 0;
      yield* phase.write();
      apply(ls, rest);
      yield* phase.read();
      if (holds(0, [...plans.keys()])) {
        const gaps = plans.map((p) => {
          const m = margins(p, 0, rest);
          return info(p, m.left, m.right, layout.inner, ls, slack / plans.length);
        });
        return { gaps, slack: room };
      }
    }
    yield* phase.write();
    apply(0, 0);
    return { gaps: infos, slack: room };
  }

  const dots = mode === 'dots';
  const sides = (p: GapPlan) => (p.naturalLeft !== null ? 1 : 0) + (p.naturalRight !== null ? 1 : 0);
  const gapsOf = (p: GapPlan) => sides(p) + (dots ? layout.natural.length : 0);

  for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
    const ellipses = byLine.get(line)!;
    if (!t.known) yield* phase.read();
    const lineRoom = edge - (t.boxes()[line]?.right ?? edge);
    const total = ellipses.reduce((sum, j) => sum + gapsOf(plans[j]!), 0);
    if (lineRoom <= 0 || total === 0) continue;
    for (const inset of insets) {
      const slack = lineRoom - inset;
      if (slack <= 0) break;
      // Each ellipsis takes a share in proportion to the gaps it spreads it over.
      yield* phase.write();
      const tried = new Map<number, GapInfo>();
      for (const j of ellipses) {
        const p = plans[j]!;
        const count = gapsOf(p);
        if (count === 0) continue;
        const share = (slack * count) / total;
        let used = share;
        let left = p.marginLeft;
        let right = p.marginRight;
        let inner = layout.inner;
        if (dots) {
          // Every gap of this ellipsis becomes the same width.
          const current = [
            ...(p.naturalLeft !== null ? [p.naturalLeft + p.marginLeft] : []),
            ...layout.natural.map((v, i) => v + layout.inner[i]!),
            ...(p.naturalRight !== null ? [p.naturalRight + p.marginRight] : []),
          ];
          const sum = current.reduce((total, v) => total + v, 0);
          // As wide as `maxGap` allows, but never taking room away.
          const even = Math.max(sum / count, Math.min((sum + share) / count, cap));
          if (p.naturalLeft !== null) left = even - p.naturalLeft;
          if (p.naturalRight !== null) right = even - p.naturalRight;
          inner = layout.natural.map((v) => even - v);
          used = Math.max(0, even * count - sum);
        } else {
          const each = share / count;
          const grow = (natural: number | null, margin: number) =>
            natural === null ? 0 : Math.max(0, Math.min(each, cap - natural - margin));
          const [l, r] = [grow(p.naturalLeft, left), grow(p.naturalRight, right)];
          left += l;
          right += r;
          used = l + r;
        }
        t.space(j, left, right, inner);
        tried.set(j, info(p, left, right, inner, 0, used));
      }
      if (!t.sure) yield* phase.read();
      if (t.sure || holds(line, ellipses)) {
        for (const [j, g] of tried) infos[j] = g;
        break;
      }
      yield* phase.write();
      for (const j of ellipses) t.space(j, plans[j]!.marginLeft, plans[j]!.marginRight, layout.inner);
    }
  }
  return { gaps: infos, slack: room };
}
