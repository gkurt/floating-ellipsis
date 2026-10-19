import { code } from './examples.ts';
import { $, resizable } from './ui.ts';

/** What the home page and the advanced page share: building scenes, and boxes that sweep their width once as they come into view. */

export const calmMotion = !matchMedia('(prefers-reduced-motion: reduce)').matches;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  node.innerHTML = html;
  return node;
}

export function setCode(id: string, src: string) {
  $(`#${id}`).innerHTML = code(src);
}

/** The widest a box may be: its parent's content width. */
export function room(box: HTMLElement) {
  const parent = box.parentElement!;
  const cs = getComputedStyle(parent);
  return parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

const smooth = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/**
 * Resizable by its handle; the first time it's well in view, its width
 * sweeps through `widths` (fractions of the room it has), unless the handle
 * is taken first.
 */
export function stage(box: HTMLElement, widths: number[]) {
  let taken = false;
  resizable(box, () => (taken = true));
  if (!calmMotion) return;
  const seen = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      seen.disconnect();
      void sweep();
    },
    { threshold: 0.6 },
  );
  seen.observe(box);
  async function sweep() {
    for (const to of widths) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const from = box.getBoundingClientRect().width;
      const target = to * room(box);
      const ms = Math.min(1700, Math.max(700, Math.abs(target - from) * 2.6));
      const start = performance.now();
      const done = await new Promise<boolean>((resolve) => {
        const frame = (now: number) => {
          if (taken) return resolve(false);
          const k = Math.min(1, (now - start) / ms);
          box.style.width = `${from + (target - from) * smooth(k)}px`;
          if (k < 1) requestAnimationFrame(frame);
          else resolve(true);
        };
        requestAnimationFrame(frame);
      });
      if (!done) return;
    }
    // Back to a share of the room, so it follows the window from here.
    box.style.width = `${widths.at(-1)! * 100}%`;
  }
}
