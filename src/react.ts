'use client';

/**
 * React bindings: `useElide` for an element you render, `Elided` for one it
 * renders. Either way the text goes in as the `text` option, not as children:
 * the instance owns the element's content, and React must not touch it.
 */
import {
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactElement,
  type Ref,
  type RefCallback,
  createElement,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type BindingOptions, Binding } from './bind.ts';
import type { Elide } from './elide.ts';
import { DEFAULTS } from './options.ts';

/**
 * Truncate the element the returned ref is put on, with `options`, kept up to
 * date on every render. Render the element empty and pass the text as
 * `options.text`. The instance is null until the element mounts.
 *
 * ```jsx
 * const [ref] = useElide({ text: path, position: 'middle' });
 * return <div ref={ref} />;
 * ```
 *
 * Options are compared by value, so inline arrays and patterns are fine; a
 * `snap` made inline (`separators()`) is new on every render and re-truncates,
 * so make it once, outside the component.
 */
export function useElide<T extends HTMLElement = HTMLElement>(options: BindingOptions = {}): [ref: RefCallback<T>, instance: Elide | null] {
  const binding = useRef<Binding | null>(null);
  // The options as last committed, for an element attached later.
  const latest = useRef(options);
  const [instance, setInstance] = useState<Elide | null>(null);

  const ref = useCallback((element: T | null) => {
    binding.current?.destroy();
    binding.current = element ? new Binding(element, latest.current) : null;
    setInstance(binding.current?.instance ?? null);
  }, []);

  // Before paint, so a change of text never shows untruncated.
  useLayoutEffect(() => {
    latest.current = options;
    binding.current?.set(options);
  });
  return [ref, instance];
}

const OPTIONS = new Set<string>(['text', 'onChange', ...Object.keys(DEFAULTS)]);

export type ElidedProps<T extends ElementType = 'div'> = BindingOptions & {
  /** The full text. */
  text: string;
  /** The element to render. Default 'div'. */
  as?: T;
  /** The rendered element, as `asChild` and `render` props pass (Radix, Base UI). React 19. */
  ref?: Ref<HTMLElement>;
} & Omit<ComponentPropsWithoutRef<T>, keyof BindingOptions | 'children' | 'as'>;

/**
 * An element (a `div` unless `as` says otherwise) showing `text`, truncated
 * with the rest of the props as options. Other props, and `ref`, go to the
 * element, so it can be the child of `asChild` (Radix) or a `render` prop
 * (Base UI). It renders the text, marked `data-elide-fallback`, so with
 * fallback.css a server-rendered page shows it truncated before it hydrates.
 *
 * ```jsx
 * <Elided text={path} position="middle" keep={/\.[^.]+$/} className="path" />
 * ```
 */
export function Elided<T extends ElementType = 'div'>(props: ElidedProps<T>): ReactElement {
  const { as, ref: forwarded, text, lines = 1, ...rest } = props;
  const options: Record<string, unknown> = { text, lines };
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (OPTIONS.has(key)) options[key] = value;
    else attributes[key] = value;
  }
  const [bind] = useElide(options);
  const ref = useHandedOn(bind, forwarded);
  // The text as first rendered, so server-rendered HTML shows it (truncated
  // by fallback.css) before hydrating. It never changes after, so React
  // leaves the content to the instance.
  const [initial] = useState(() => escape(text));
  return createElement(as ?? 'div', {
    ...attributes,
    ref,
    'data-elide-fallback': lines > 1 ? String(lines) : '',
    dangerouslySetInnerHTML: { __html: initial },
  });
}

/** `bind` as a ref callback that also hands the element to `forwarded`. */
function useHandedOn(bind: RefCallback<HTMLElement>, forwarded: Ref<HTMLElement> | undefined): RefCallback<HTMLElement> {
  const element = useRef<HTMLElement | null>(null);
  // Apart from the binding's ref, so a parent's new ref every render doesn't
  // remake the instance.
  useImperativeHandle(forwarded, () => element.current!);
  return useCallback(
    (el: HTMLElement | null) => {
      element.current = el;
      bind(el);
    },
    [bind],
  );
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
