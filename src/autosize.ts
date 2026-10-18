/**
 * Auto-sizing (`floating-ellipsis/autosize`): an element whose width comes
 * from its content takes the width its full text would, whatever part of it
 * shows.
 */
import type { AutoSize, AutoSizeSlot } from './options.ts';

/**
 * For the `autoSize` option, on an element whose width comes from its
 * content: an inline-block, a float, an absolutely positioned element, a
 * flex or grid item sized by it. Its width would otherwise come from the cut
 * that shows, so it could shrink but never grow back. An invisible copy of
 * the full text (with its elements, and a suffix that always shows) sizes it
 * instead, as the text would, up to the room it has.
 */
export function autoSize(): AutoSize {
  return AUTO_SIZE;
}

const AUTO_SIZE: AutoSize = { place: (host) => new Slot(host) };

/**
 * Laid out, so it counts towards the element's width as content does, but
 * taking no height, unseen and out of reach. Layout containment keeps its
 * lines from giving the element its first baseline; coming first, it can't
 * give its last.
 */
const CSS = 'display:block;contain:layout;height:0;overflow:hidden;visibility:hidden;user-select:none;pointer-events:none';

class Slot implements AutoSizeSlot {
  readonly text: HTMLSpanElement = document.createElement('span');
  readonly #el: HTMLSpanElement = document.createElement('span');
  #suffix: Element | null = null;

  constructor(host: HTMLElement) {
    const el = this.#el;
    el.setAttribute('data-fp-sizer', '');
    el.setAttribute('aria-hidden', 'true');
    // Out of the tab order, and of find in page.
    el.inert = true;
    el.style.cssText = CSS;
    el.append(this.text);
    host.prepend(el);
  }

  suffix(suffix: Element | null): void {
    this.#suffix?.remove();
    this.#suffix = null;
    if (!suffix) return;
    const copy = suffix.cloneNode(true);
    if (!(copy instanceof Element)) return;
    for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id');
    this.#suffix = copy;
    this.#el.append(copy);
  }

  remove(): void {
    this.#el.remove();
  }
}
