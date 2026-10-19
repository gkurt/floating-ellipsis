/**
 * What instances share across the document: copying across an ellipsis,
 * expanding text that find in page found, and re-truncating when web fonts
 * load.
 */
import type { Range } from './cut.ts';
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
export const byId = new Map<
  string,
  {
    instance: Elide;
    hidden: () => readonly Part[];
    /** Find in page found text ellipsis `part` hides, starting in `word` when that's known. */
    found: (part: number, word: Range | null) => void;
    /** Undo that: collapse, or stop keeping it in sight. */
    unfound: () => void;
  }
>();

let hooked = false;

export function hookDocument(): void {
  if (hooked || typeof document === 'undefined') return;
  hooked = true;
  document.addEventListener('copy', onCopy);
  document.addEventListener('beforematch', onBeforeMatch, true);
  document.addEventListener('pointerdown', onPointerDown, true);
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
    const { copy } = entry.instance.options;
    el.replaceWith(copy === 'full' || entry.instance.state.expanded ? part.text : ellipsisText(entry.instance.markStyle));
  }
  if (!touched) return;

  // (What an ellipsis hides is copied in its place, expanded or not, and the copy `autoSize` sizes the element with isn't seen.)
  for (const el of fragment.querySelectorAll('[data-fp-full], [data-fp-ghosts], [data-fp-found], [data-fp-sizer]')) el.remove();
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:pre-wrap';
  holder.append(fragment);
  document.body.append(holder);
  // Without the joiners that glue a suffix or marks to the text, or what stands for an image without alt text.
  event.clipboardData.setData('text/plain', holder.innerText.replace(/[\u2060\uFFFC]/g, ''));
  event.clipboardData.setData('text/html', holder.innerHTML);
  holder.remove();
  event.preventDefault();
}

/** The entry of the instance find in page last expanded. */
let found: { instance: Elide; unfound: () => void } | null = null;

/** It isn't expanded by find any more (it collapsed, something else opened it, or it's gone). */
export function forgetFound(instance: Elide): void {
  if (found?.instance === instance) found = null;
}

/** A word find in page found, until the event for what holds it. */
let word: HTMLElement | null = null;

/**
 * Find in page found text an ellipsis hides (in its `hidden="until-found"`
 * copy). The event comes for the word the match starts in, if any, then for
 * the hidden part around it. One instance at a time shows what it found:
 * the one before stops.
 */
function onBeforeMatch(event: Event) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const el = target?.closest<HTMLElement>('[data-fp-found]');
  if (!target || !el) return;
  if (target.dataset.fpWord) {
    word = target;
  } else if (word && el.contains(word)) {
    word = null;
    return;
  }
  const [id, part] = (el.dataset.fpFound ?? '').split(':');
  const entry = byId.get(id ?? '');
  if (!entry) return;
  if (found && found.instance !== entry.instance) found.unfound();
  const range = target.dataset.fpWord?.split(':').map(Number);
  entry.found(Number(part), range?.length === 2 ? [range[0]!, range[1]!] : null);
  found = entry;
}

/** A press outside the instance find expanded collapses it. */
function onPointerDown(event: PointerEvent) {
  if (!found || (event.target instanceof Node && found.instance.element.contains(event.target))) return;
  const { unfound } = found;
  found = null;
  unfound();
}
