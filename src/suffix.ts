/**
 * Suffixes (`floating-ellipsis/suffix`): content after the text, on its last
 * line, never truncated.
 */
import { WORD_JOINER } from './join.ts';
import type { Suffix, SuffixSlot } from './options.ts';

/**
 * Content to follow the text on its last line, never truncated, for the `suffix`
 * option: a "Read more" button, a badge, a timestamp. A string, or a node,
 * which is moved there (and back on `destroy()`). `show`: 'always'
 * (default), or only while the text is 'truncated'.
 */
export function suffix(content: string | Node, { show = 'always' }: { show?: Suffix['show'] } = {}): Suffix {
  return { content, show, place };
}

const place = (host: HTMLElement, resized: () => void): SuffixSlot => new Slot(host, resized);

class Slot implements SuffixSlot {
  readonly el: HTMLSpanElement = document.createElement('span');
  /** Its width when last measured for fitting. */
  width = 0;
  readonly #host: HTMLElement;
  /** A node taken from elsewhere, and where it was, to put it back. */
  #home: [node: Node, parent: Node, next: Node | null] | null = null;
  /** Tells when a node's content changes. */
  readonly #watcher: MutationObserver;

  /** `resized`: the content changed width since it was fitted, so the text must fit again. */
  constructor(host: HTMLElement, resized: () => void) {
    this.#host = host;
    this.el.setAttribute('data-fp-suffix', '');
    this.el.style.whiteSpace = 'nowrap';
    // Only a change of width matters: a listener that sets the same label
    // again on every pass mustn't start another one.
    this.#watcher = new MutationObserver(() => {
      if (Math.abs(this.el.getBoundingClientRect().width - this.width) > 0.01) resized();
    });
  }

  /** Show `content` after the host's line. A node is moved there from wherever it was. */
  fill(content: string | Node): void {
    this.giveBack(false);
    if (typeof content === 'object') {
      if (content.parentNode) this.#home = [content, content.parentNode, content.nextSibling];
      this.#watcher.observe(content, { subtree: true, childList: true, characterData: true, attributes: true });
    }
    // The joiner keeps it on the line of what comes before it (a line can
    // break after the ellipsis' marks, which are inline blocks).
    this.el.replaceChildren(WORD_JOINER, content);
    this.#host.append(this.el);
  }

  /** Its width now, for fitting. Reads layout. */
  measure(): number {
    return (this.width = this.el.getBoundingClientRect().width);
  }

  show(on: boolean): void {
    this.el.style.display = on ? '' : 'none';
  }

  /**
   * Put a node back where it was taken from. One that was the host's own
   * child comes back with the host's content on `destroy` (`destroying`).
   */
  giveBack(destroying: boolean): void {
    this.#watcher.disconnect();
    const home = this.#home;
    this.#home = null;
    if (!home) return;
    const [node, parent, next] = home;
    if (parent !== this.#host) parent.insertBefore(node, next?.parentNode === parent ? next : null);
    else if (!destroying) node.parentNode?.removeChild(node);
  }
}
