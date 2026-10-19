/**
 * `onChange` (`floating-ellipsis/changes`): what each pass changed in the
 * visible text, with where glyphs and marks were before, for animating it.
 */
import type { Elide, Run, Tracker } from './elide.ts';
import { markInks } from './geometry.ts';
import { inside } from './inside.ts';
import { inkOf } from './metrics.ts';
import { type ChangeReason, type ElideState, type Part, isVisible } from './options.ts';

type Boxes = Map<number, { box: DOMRect; ink: DOMRect }>;

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
  hiddenGlyphs: Boxes;
  /** Glyph mode only: box and ink box of every glyph that was showing, as last painted. */
  glyphsBefore: Boxes;
  /** Mark boxes of each ellipsis just before the update. */
  marksBefore: DOMRect[][];
}

/** An instance's listeners, and where things were painted, relative to the host. */
interface Track extends Tracker {
  listeners: Set<(change: ElideChange) => void>;
  painting: { glyphs: Boxes; marks: DOMRect[][] } | null;
  /** Where things were before the pass now finishing, moved to where the host is now. */
  before: { glyphs: Boxes; marks: DOMRect[][] };
}

const tracks = new WeakMap<Elide, Track>();

/**
 * Call `fn` when the visible text changes: what showed and hid, with the
 * boxes glyphs (in glyph mode) and marks were painted in before. Returns an
 * unsubscribe function.
 */
export function onChange(instance: Elide, fn: (change: ElideChange) => void): () => void {
  let track = tracks.get(instance);
  if (!track) {
    track = trackOf(instance);
    tracks.set(instance, track);
    const s = inside(instance);
    s.track(track);
    // Passes record what they paint only for listeners; the next change animates from here.
    if (s.current && s.run) track.painted(s.run, null);
  }
  track.listeners.add(fn);
  return () => {
    if (!track.listeners.delete(fn) || track.listeners.size > 0) return;
    tracks.delete(instance);
    inside(instance).track(null);
  };
}

function trackOf(instance: Elide): Track {
  const track: Track = {
    listeners: new Set(),
    painting: null,
    before: { glyphs: new Map(), marks: [] },
    painted(run: Run, since: DOMRect | null) {
      const was = track.painting;
      const moved = (r: DOMRect) => new DOMRect(r.x + since!.x, r.y + since!.y, r.width, r.height);
      track.before = { glyphs: new Map(), marks: [] };
      if (since && was) {
        track.before.marks = was.marks.map((boxes) => boxes.map(moved));
        for (const [i, g] of was.glyphs) track.before.glyphs.set(i, { box: moved(g.box), ink: moved(g.ink) });
      }
      const s = inside(instance);
      const origin = instance.element.getBoundingClientRect();
      const local = (r: DOMRect) => new DOMRect(r.x - origin.x, r.y - origin.y, r.width, r.height);
      const glyphs: Boxes = new Map();
      s.glyphs.forEach((el, i) => {
        if (!el.isConnected) return;
        const box = el.getBoundingClientRect();
        glyphs.set(i, { box: local(box), ink: local(inkOf(run, instance.graphemes[i], box)) });
      });
      track.painting = { glyphs, marks: (s.current?.hidden ?? []).map((_, j) => markInks(instance, j).map(local)) };
    },
    done(reason, previous, state, reset) {
      const change = changeOf(reason, previous, state, reset, track.before.glyphs, track.before.marks);
      if (change) for (const fn of track.listeners) fn(change);
    },
  };
  return track;
}

/**
 * What a pass changed: null when there's nothing to tell (a resize or
 * refresh that left the cut as it was).
 */
function changeOf(
  reason: ChangeReason,
  previous: ElideState | null,
  state: ElideState,
  reset: boolean,
  glyphsBefore: Boxes,
  marksBefore: DOMRect[][],
): ElideChange | null {
  const same =
    previous &&
    !reset &&
    sameParts(previous.hidden, state.hidden) &&
    sameParts(previous.short, state.short) &&
    previous.short.every((p, i) => p.form === state.short[i]!.form);
  if (same && (reason === 'resize' || reason === 'refresh')) return null;
  const shown: number[] = [];
  const hidden: number[] = [];
  const hiddenGlyphs: Boxes = new Map();
  if (!reset && previous) {
    for (let i = 0; i < state.length; i++) {
      const was = isVisible(previous, i);
      const is = isVisible(state, i);
      if (is && !was) {
        shown.push(i);
      } else if (was && !is) {
        hidden.push(i);
        const before = glyphsBefore.get(i);
        if (before) hiddenGlyphs.set(i, before);
      }
    }
  }
  return { reason, state, previous: reset ? null : previous, reset, shown, hidden, hiddenGlyphs, glyphsBefore, marksBefore };
}

/** Whether two lists of parts cover the same graphemes. */
function sameParts(a: readonly Part[], b: readonly Part[]): boolean {
  return a.length === b.length && a.every((p, i) => p.start === b[i]!.start && p.end === b[i]!.end);
}
