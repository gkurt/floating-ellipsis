import type { Elide } from '../src/index.js';

// The README's example, verbatim but for the types.

// `tip` is a `position: fixed` element with the same font as the text, styled
// as in the CSS above: its background is a layer of its own (`.grow-tip-bg`),
// so it can grow without reflowing the text.
export function growTip(t: Elide, tip: HTMLElement) {
  if (!t.truncated) return;

  // Where each grapheme is now: its own box, or for a hidden one, its place in
  // the ellipsis hiding it (spread across it, in order).
  const from = t.graphemes.map((_, i) => t.graphemeRect(i));
  const arriving = from.map((r) => !r);
  t.state.hidden.forEach((part, j) => {
    const area = t.ellipsisArea(j)!;
    const count = part.end - part.start;
    for (let k = 0; k < count; k++) {
      from[part.start + k] = new DOMRect(area.left + ((k + 0.5) / count) * area.width, area.top, 0, area.height);
    }
  });
  // The dots of every ellipsis, as drawn, and the line.
  const dots = t.state.hidden.flatMap((_, j) => t.markElements(j).map((el) => ({ el, rect: el.getBoundingClientRect() })));
  const lines = t.lineRects();

  // The tip as it ends up: the full text, one span per grapheme, over the line.
  const bg = document.createElement('div');
  bg.className = 'grow-tip-bg';
  const spans = t.graphemes.map((g) => {
    const span = document.createElement('span');
    span.textContent = g;
    span.style.position = 'relative';
    return span;
  });
  tip.replaceChildren(bg, ...spans);
  const view = document.documentElement.clientWidth;
  tip.style.left = `${lines[0]!.left}px`;
  tip.style.top = `${lines[0]!.top}px`;
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
    tip.style.left = `${lines[0]!.left - (box.left - 8)}px`;
  } else if (box.right > view - 8) {
    tip.style.left = `${lines[0]!.left - (box.right - (view - 8))}px`;
  }
  box = tip.getBoundingClientRect();

  // Every grapheme travels from where it was. (Inline text can't be
  // transformed, so they move by relative offsets, which don't reflow
  // anything.) Hidden ones come out of their ellipsis, blurred, and only show
  // once the others have made some room.
  const timing = { duration: 460, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' } as const;
  spans.forEach((span, i) => {
    const to = span.getBoundingClientRect();
    const top = `${from[i]!.top - to.top}px`;
    if (!arriving[i]) {
      span.animate([{ left: `${from[i]!.left - to.left}px`, top }, { left: '0px', top: '0px' }], timing);
      return;
    }
    const left = `${from[i]!.left - (to.left + to.width / 2)}px`;
    span.animate(
      [
        { left, top, opacity: 0, filter: 'blur(3px)' },
        { offset: 0.15, opacity: 0 },
        { offset: 0.6, opacity: 1, filter: 'blur(0px)' },
        { left: '0px', top: '0px', opacity: 1, filter: 'blur(0px)' },
      ],
      timing,
    );
  });

  // The dots stay where they are and fade as the text comes in.
  for (const { el, rect } of dots) {
    const dot = el.cloneNode(true) as HTMLElement;
    Object.assign(dot.style, { position: 'absolute', margin: '0', transform: 'none', left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px` });
    tip.append(dot);
    dot.animate({ opacity: [1, 0] }, { duration: 160, fill: 'forwards' });
  }

  // The background grows from the line's box (padded like the tip) to the tip's.
  const cs = getComputedStyle(tip);
  const lineHeight = parseFloat(cs.lineHeight) || lines[0]!.height * 1.2;
  const start = {
    left: Math.min(...lines.map((l) => l.left)) - parseFloat(cs.paddingLeft),
    right: Math.max(...lines.map((l) => l.right)) + parseFloat(cs.paddingRight),
    bottom: box.top + parseFloat(cs.paddingTop) + lines.length * lineHeight + parseFloat(cs.paddingBottom),
  };
  const inset = `0px ${box.right - start.right}px ${box.bottom - start.bottom}px ${start.left - box.left}px`;
  bg.animate([{ inset }, { inset: '0px' }], timing);
}
