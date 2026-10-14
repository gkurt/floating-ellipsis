/** Small UI helpers shared by the demo pages. */

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;

/** Segmented control: calls back with the pressed button's value. */
export function segmented(name: string, onPick: (value: string) => void): void {
  const seg = $(`.seg[data-name="${name}"]`);
  seg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
    onPick(btn.value);
  });
}

/** Drag the box's handle (or use arrow keys on it) to change its width, up to its parent's content width. */
export function resizable(box: HTMLElement, onResize?: () => void): void {
  const handle = $('.handle', box);
  const setWidth = (w: number) => {
    const parent = box.parentElement!;
    const cs = getComputedStyle(parent);
    const max = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    box.style.width = `${Math.max(80, Math.min(max, w))}px`;
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = box.getBoundingClientRect().width;
    onResize?.();
    const move = (ev: PointerEvent) => setWidth(startW + ev.clientX - startX);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    onResize?.();
    setWidth(box.getBoundingClientRect().width + dir * (e.shiftKey ? 40 : 8));
  });
}
