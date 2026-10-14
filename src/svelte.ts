/**
 * Svelte binding: the `elide` action. Its parameter is the options, text
 * included; leave the element empty, since the instance owns its content.
 *
 * ```svelte
 * <script>
 *   import { elide } from 'floating-ellipsis/svelte';
 * </script>
 * <div use:elide={{ text: path, position: 'middle' }}></div>
 * ```
 */
import { Binding } from './bind.ts';
import type { ElideOptions } from './options.ts';

export function elide(node: HTMLElement, options?: ElideOptions): { update: (options?: ElideOptions) => void; destroy: () => void } {
  const binding = new Binding(node, options);
  return {
    update: (next) => binding.set(next),
    destroy: () => binding.destroy(),
  };
}
