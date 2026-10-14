/**
 * Selecting text in a tooltip that floats over the text it shows.
 *
 * The tip ignores the pointer, so hovering what's under it keeps working.
 * But a press that lands on it (with a mouse or pen) is the tip's: it takes
 * the pointer, the press starts a selection in its text, and dragging extends
 * it, clamped to the tip's text so the selection never leaves it. A double
 * press selects a word or path segment, a triple press all of it.
 *
 * A press also pins the tip, but only while it's hovered: `held()` is true
 * then, and callers shouldn't close or replace it, even where it sticks out
 * past what it belongs to. When the pointer leaves it (or a drag ends outside
 * it), `keep(x, y)` decides: true leaves it open as a plain hover tip again
 * (say the pointer is back on its row); false closes it, through `dismiss`.
 * Escape dismisses it too, pinned or not.
 */
export function selectableTip(
  tip: HTMLElement,
  { dismiss, keep }: { dismiss: () => void; keep: (x: number, y: number) => boolean },
) {
  let holding = false;
  let dragging = false;
  let anchor: Caret | null = null;
  // Pointer events don't count clicks (their `detail` is 0), so presses are
  // counted here: one soon enough after the last, close enough to it, adds one.
  let presses = { count: 0, time: 0, x: 0, y: 0 };

  const showing = () => !tip.hidden && tip.isConnected;
  const inside = (x: number, y: number) => {
    const r = tip.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const selection = () => document.getSelection();
  const selectionInTip = () => {
    const s = selection();
    return !!s && !s.isCollapsed && tip.contains(s.anchorNode) && tip.contains(s.focusNode);
  };

  function hold(on: boolean) {
    holding = on;
    tip.style.pointerEvents = on ? 'auto' : '';
    tip.style.cursor = on ? 'text' : '';
  }

  /** Let go, and close unless told to keep it. */
  function close() {
    hold(false);
    dragging = false;
    if (selectionInTip()) selection()!.removeAllRanges();
    dismiss();
  }

  /** The pointer is off the tip: back to hovering, or closed. */
  function leave(x: number, y: number) {
    if (!holding || dragging) return;
    hold(false);
    if (!keep(x, y)) close();
  }

  const onPress = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch' || !showing() || !inside(e.clientX, e.clientY)) return;
    // The tip's press: not the text under it.
    e.preventDefault();
    e.stopPropagation();
    for (const a of tip.getAnimations({ subtree: true })) a.finish();
    hold(true);
    tip.setPointerCapture(e.pointerId);
    const again = e.timeStamp - presses.time < 500 && Math.hypot(e.clientX - presses.x, e.clientY - presses.y) < 5;
    presses = { count: again ? presses.count + 1 : 1, time: e.timeStamp, x: e.clientX, y: e.clientY };
    const at = caretAt(tip, e.clientX, e.clientY);
    if (!at) return;
    if (presses.count === 2) return selectAround(tip, at);
    if (presses.count >= 3) return selectAll(tip);
    anchor = at;
    dragging = true;
    selection()?.setBaseAndExtent(at.node, at.offset, at.node, at.offset);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || !anchor) return;
    const at = caretAt(tip, e.clientX, e.clientY);
    if (at) selection()?.setBaseAndExtent(anchor.node, anchor.offset, at.node, at.offset);
  };

  const onUp = (e: PointerEvent) => {
    if (!holding) return;
    dragging = false;
    if (tip.hasPointerCapture(e.pointerId)) tip.releasePointerCapture(e.pointerId);
    if (!inside(e.clientX, e.clientY)) leave(e.clientX, e.clientY);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && showing()) close();
  };

  // Capture, so the press is ours before the page under the tip sees it.
  document.addEventListener('pointerdown', onPress, true);
  tip.addEventListener('pointermove', onMove);
  tip.addEventListener('pointerup', onUp);
  tip.addEventListener('pointercancel', onUp);
  tip.addEventListener('pointerleave', (e) => leave(e.clientX, e.clientY));
  document.addEventListener('keydown', onKey);

  return {
    /** Whether the tip is pinned (pressed onto, and hovered): keep it open and as it is. */
    held: () => holding,
    /** Let go without closing (e.g. the caller is about to hide it anyway). */
    release() {
      if (!holding) return;
      hold(false);
      dragging = false;
      if (selectionInTip()) selection()!.removeAllRanges();
    },
  };
}

interface Caret {
  node: Text;
  offset: number;
}

/** Parts of a tip that aren't its text: drawn dots, background layers. */
const NOT_TEXT = '[data-fp-mark], .grow-tip-bg, .tip-bg';

/** The tip's text nodes, in order. */
function textNodes(tip: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(tip, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest(NOT_TEXT)) out.push(n as Text);
  }
  return out;
}

/** The text position under a point, with the point first pulled inside the tip's text. */
function caretAt(tip: HTMLElement, x: number, y: number): Caret | null {
  const r = tip.getBoundingClientRect();
  const cs = getComputedStyle(tip);
  x = Math.min(Math.max(x, r.left + parseFloat(cs.paddingLeft) + 1), r.right - parseFloat(cs.paddingRight) - 1);
  y = Math.min(Math.max(y, r.top + parseFloat(cs.paddingTop) + 1), r.bottom - parseFloat(cs.paddingBottom) - 1);
  let node: Node | null = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    node = p?.offsetNode ?? null;
    offset = p?.offset ?? 0;
  } else {
    const range = document.caretRangeFromPoint?.(x, y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  if (!node || !tip.contains(node)) return null;
  const texts = textNodes(tip);
  if (node instanceof Text && texts.includes(node)) return { node, offset };
  // An element: the nearest text at or after that child, else the end.
  const child = node.childNodes[offset] ?? null;
  const after = texts.find((t) => (child ? child === t || child.contains(t) || !!(child.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) : false));
  if (after) return { node: after, offset: 0 };
  const last = texts[texts.length - 1];
  return last ? { node: last, offset: last.length } : null;
}

/** Select the word or path segment around a caret. */
function selectAround(tip: HTMLElement, at: Caret) {
  const texts = textNodes(tip);
  const starts: number[] = [];
  let full = '';
  for (const t of texts) {
    starts.push(full.length);
    full += t.data;
  }
  const index = starts[texts.indexOf(at.node)]! + at.offset;
  const breaks = /[\s/\\]/;
  let a = index;
  let b = index;
  while (a > 0 && !breaks.test(full[a - 1]!)) a--;
  while (b < full.length && !breaks.test(full[b]!)) b++;
  if (a === b) b = Math.min(full.length, b + 1);
  const point = (i: number): Caret => {
    let k = texts.length - 1;
    while (k > 0 && starts[k]! > i) k--;
    return { node: texts[k]!, offset: i - starts[k]! };
  };
  const from = point(a);
  const to = point(b);
  document.getSelection()?.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
}

/** Select all of the tip's text. */
function selectAll(tip: HTMLElement) {
  const texts = textNodes(tip);
  const first = texts[0];
  const last = texts[texts.length - 1];
  if (first && last) document.getSelection()?.setBaseAndExtent(first, 0, last, last.length);
}
