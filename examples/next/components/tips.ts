import type { Elide } from 'floating-ellipsis';
import { type Tooltip, type TooltipOptions, tooltip } from 'floating-ellipsis/tooltip';
import { transitions } from 'floating-ellipsis/transitions';

/** A tooltip made on first use: `instanceRef` callbacks only run in the browser. */
function lazy(options: TooltipOptions): () => Tooltip {
  let tips: Tooltip | undefined;
  return () => (tips ??= tooltip(options));
}

// One for each kind, so moving along a list waits only for its first tip.
const grown = lazy({ breaks: '/', delay: 300 });
const peeked = lazy({ reveal: 'peek', delay: 120, offset: 10 });

/** Shows tips for `t` from the row it's in (`[data-tip-row]`), and lets its dots glide as it refits. */
function attach(tips: () => Tooltip) {
  return (t: Elide | null) => {
    if (!t) return undefined;
    const detach = tips().attach(t, t.element.closest('[data-tip-row]') ?? t.element);
    const stop = transitions(t);
    return () => {
      detach();
      stop();
    };
  };
}

/**
 * For `instanceRef`. Module-level, so the same function every render: a new
 * one would detach and attach again.
 */
export const TIPS = {
  /** The full text, grown over the line out of it. */
  grow: attach(grown),
  /** What the hovered ellipsis hides, beside it. */
  peek: attach(peeked),
};

export type Tip = keyof typeof TIPS;
