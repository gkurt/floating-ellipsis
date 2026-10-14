import type { Elide } from '../src/index.js';

// The README's example, verbatim but for the types.

// `tip` is a `position: fixed` element with the same font as the text.
export function growTip(t: Elide, tip: HTMLElement) {
  if (!t.truncated) return;

  // Where each grapheme is now: its own box, or the middle of the ellipsis hiding it.
  const from = t.graphemes.map((_, i) => t.graphemeRect(i));
  const arriving = from.map((r) => !r);
  t.state.hidden.forEach((part, j) => {
    const area = t.ellipsisArea(j)!;
    for (let i = part.start; i < part.end; i++) {
      from[i] = new DOMRect(area.left + area.width / 2, area.top, 0, area.height);
    }
  });

  // The tip as it ends up: the full text, one span per grapheme, over the
  // line, wrapping at the window's edge (after a separator, where it can).
  const spans = t.graphemes.map((g) => {
    const span = document.createElement('span');
    span.textContent = g;
    span.style.position = 'relative';
    return span;
  });
  tip.replaceChildren(...spans.flatMap((span, i) => ('/\\'.includes(t.graphemes[i]!) ? [span, document.createElement('wbr')] : [span])));
  const line = t.lineRects()[0]!;
  tip.style.left = `${line.left}px`;
  tip.style.top = `${line.top}px`;
  tip.style.maxWidth = `${document.documentElement.clientWidth - line.left - 24}px`;
  tip.hidden = false;

  // Every grapheme travels from where it was. (Inline text can't be
  // transformed, so they move by relative offsets, which don't reflow anything.)
  const timing = { duration: 450, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' } as const;
  spans.forEach((span, i) => {
    const to = span.getBoundingClientRect();
    span.animate(
      [
        { left: `${from[i]!.left - to.left}px`, top: `${from[i]!.top - to.top}px`, opacity: arriving[i] ? 0 : 1 },
        { left: '0px', top: '0px', opacity: 1 },
      ],
      timing,
    );
  });

  // And the tip opens out from the line's box to its own.
  const box = tip.getBoundingClientRect();
  const inset = `${line.top - box.top}px ${box.right - line.right}px ${box.bottom - line.bottom}px ${line.left - box.left}px`;
  tip.animate([{ clipPath: `inset(${inset} round 4px)` }, { clipPath: 'inset(0 round 8px)' }], timing);
}
