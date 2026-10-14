/**
 * Hover delays for tooltips, shared by group.
 *
 * A tip waits `delay()` ms before showing, unless a tip of its group is
 * showing, or closed less than `grace` ms ago: then it shows at once, so
 * moving along a list of tipped things only makes you wait for the first.
 * An element's group is the nearest `data-tip-group` attribute on it or its
 * ancestors (`<ul data-tip-group="files">`); without one, it's a group of its
 * own. Tell the delays when a tip opens and closes with `opened` and `closed`.
 */
export function tipDelays(options: { delay: () => number; grace?: number }) {
  const grace = options.grace ?? 300;
  const groups = new Map<string | Element, { showing: boolean; closedAt: number }>();
  let timer = 0;

  const groupOf = (el: Element) => {
    const key = el.closest<HTMLElement>('[data-tip-group]')?.dataset.tipGroup ?? el;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { showing: false, closedAt: -Infinity }));
    return group;
  };

  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
  };

  return {
    /** Show `el`'s tip, now or after the delay. Replaces whatever was waiting. */
    request(el: Element, show: () => void) {
      cancel();
      const group = groupOf(el);
      const warm = group.showing || performance.now() - group.closedAt < grace;
      const delay = options.delay();
      if (warm || delay <= 0) show();
      else timer = window.setTimeout(() => ((timer = 0), show()), delay);
    },
    /** Forget a tip that was waiting to show. */
    cancel,
    /** Whether a tip is waiting to show. */
    waiting: () => timer !== 0,
    /** A tip of `el`'s group opened. */
    opened(el: Element) {
      groupOf(el).showing = true;
    },
    /** A tip of `el`'s group closed. */
    closed(el: Element) {
      const group = groupOf(el);
      if (!group.showing) return;
      group.showing = false;
      group.closedAt = performance.now();
    },
  };
}
