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
  // And the dots of every ellipsis, as drawn.
  const dots = t.state.hidden.flatMap((_, j) => t.markElements(j).map((el) => ({ el, rect: el.getBoundingClientRect() })));

  // The tip as it ends up: the full text, one span per grapheme, over the line.
  const spans = t.graphemes.map((g) => {
    const span = document.createElement('span');
    span.textContent = g;
    span.style.position = 'relative';
    return span;
  });
  tip.replaceChildren(...spans);
  const line = t.lineRects()[0]!;
  const view = document.documentElement.clientWidth;
  tip.style.left = `${line.left}px`;
  tip.style.top = `${line.top}px`;
  tip.style.maxWidth = '';
  tip.style.whiteSpace = 'nowrap';
  tip.hidden = false;
  // One line, slid left if that's what it takes to stay on screen. Only text
  // wider than the window wraps (after a separator, where it can).
  let box = tip.getBoundingClientRect();
  if (box.width > view - 16) {
    // (Chrome breaks at <wbr> even with nowrap, so they only go in now.)
    spans.forEach((span, i) => '/\\'.includes(t.graphemes[i]!) && span.after(document.createElement('wbr')));
    tip.style.whiteSpace = '';
    tip.style.maxWidth = `${view - 16}px`;
    tip.style.left = `${line.left - (box.left - 8)}px`;
  } else if (box.right > view - 8) {
    tip.style.left = `${line.left - (box.right - (view - 8))}px`;
  }
  box = tip.getBoundingClientRect();

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

  // The dots stay where they are and fade as the text comes in.
  for (const { el, rect } of dots) {
    const dot = el.cloneNode(true) as HTMLElement;
    Object.assign(dot.style, { position: 'absolute', margin: '0', transform: 'none', left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px` });
    tip.append(dot);
    dot.animate({ opacity: [1, 0] }, { duration: 180, fill: 'forwards' });
  }

  // And the tip opens out from the line's box to its own.
  const inset = `${line.top - box.top}px ${box.right - line.right}px ${box.bottom - line.bottom}px ${line.left - box.left}px`;
  tip.animate([{ clipPath: `inset(${inset} round 4px)` }, { clipPath: 'inset(0 round 8px)' }], timing);
}
