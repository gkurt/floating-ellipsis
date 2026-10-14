/**
 * Vue binding: the `v-elide` directive. Its value is the options, text
 * included; leave the element empty, since the instance owns its content.
 *
 * ```vue
 * <script setup>
 * import { vElide } from 'floating-ellipsis/vue';
 * </script>
 * <template><div v-elide="{ text: path, position: 'middle' }" /></template>
 * ```
 *
 * Register it globally with `app.directive('elide', vElide)`.
 */
import { Binding } from './bind.ts';
import type { Elide } from './elide.ts';
import type { ElideOptions } from './options.ts';

const bindings = new WeakMap<HTMLElement, Binding>();

/** What the directive is given; a structural match for Vue's `DirectiveBinding`. */
interface Given {
  value: ElideOptions | undefined;
}

export const vElide: {
  mounted: (el: HTMLElement, binding: Given) => void;
  updated: (el: HTMLElement, binding: Given) => void;
  beforeUnmount: (el: HTMLElement) => void;
} = {
  mounted(el, { value }) {
    bindings.set(el, new Binding(el, value));
  },
  updated(el, { value }) {
    bindings.get(el)?.set(value);
  },
  beforeUnmount(el) {
    bindings.get(el)?.destroy();
    bindings.delete(el);
  },
};

/** The instance `v-elide` made for `el`, if any. */
export function elideOf(el: HTMLElement): Elide | null {
  return bindings.get(el)?.instance ?? null;
}
