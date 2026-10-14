/**
 * What instances share across the document: copying across an ellipsis, and
 * re-truncating when web fonts load.
 */
import type { Elide } from './elide.ts';
import { ellipsisText } from './marks.ts';
import { clearMetrics } from './metrics.ts';
import type { Part } from './options.ts';

/**
 * Live instances, and each by the id its ellipses carry in `data-fp-ellipsis`,
 * with the parts its ellipses hide as rendered (without running a pass it
 * has put off, as reading its state would).
 */
export const instances = new Set<Elide>();
export const byId = new Map<string, { instance: Elide; hidden: () => readonly Part[] }>();

let hooked = false;

export function hookDocument(): void {
  if (hooked || typeof document === 'undefined') return;
  hooked = true;
  document.addEventListener('copy', onCopy);
  if (typeof document.fonts === 'undefined') return;
  const refresh = () => {
    clearMetrics();
    for (const instance of instances) instance.refresh('fonts');
  };
  // Fonts that load later (often because truncating is what first lays the
  // text out) fire `loadingdone`; `ready` only matters while some are loading.
  document.fonts.addEventListener('loadingdone', refresh);
  if (document.fonts.status === 'loading') void document.fonts.ready.then(refresh);
}

/**
 * When a selection crosses an ellipsis, copy what it stands for. The
 * selection is cloned, each ellipsis in it replaced by its hidden text, and
 * the result laid out offscreen so `innerText` keeps the page's line breaks.
 */
function onCopy(event: ClipboardEvent) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !event.clipboardData) return;
  const fragment = selection.getRangeAt(0).cloneContents();
  let touched = false;
  for (const el of fragment.querySelectorAll<HTMLElement>('[data-fp-ellipsis]')) {
    const [id, index] = (el.dataset.fpEllipsis ?? '').split(':');
    const entry = byId.get(id ?? '');
    const part = entry?.hidden()[Number(index)];
    // Not showing (the first ellipsis stays in the DOM, out of sight).
    if (!entry || !part) {
      el.remove();
      continue;
    }
    touched = true;
    const { copy, ellipsis } = entry.instance.options;
    el.replaceWith(copy === 'full' ? part.text : ellipsisText(ellipsis));
  }
  if (!touched) return;

  for (const el of fragment.querySelectorAll('[data-fp-full], [data-fp-ghosts]')) el.remove();
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:pre-wrap';
  holder.append(fragment);
  document.body.append(holder);
  event.clipboardData.setData('text/plain', holder.innerText);
  event.clipboardData.setData('text/html', holder.innerHTML);
  holder.remove();
  event.preventDefault();
}
