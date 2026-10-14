/**
 * React bindings: `useElide` for an element you render, `Elided` for one it
 * renders. Either way the text goes in as the `text` option, not as children:
 * the instance owns the element's content, and React must not touch it.
 */
import {
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactElement,
  type RefCallback,
  createElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Binding } from './bind.ts';
import type { Elide } from './elide.ts';
import { type ElideOptions, DEFAULTS } from './options.ts';

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
export function useElide<T extends HTMLElement = HTMLElement>(options: ElideOptions = {}): [ref: RefCallback<T>, instance: Elide | null] {
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

export type ElidedProps<T extends ElementType = 'div'> = ElideOptions & {
  /** The full text. */
  text: string;
  /** The element to render. Default 'div'. */
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof ElideOptions | 'children' | 'as'>;

/**
 * An element (a `div` unless `as` says otherwise) showing `text`, truncated
 * with the rest of the props as options. Other props go to the element. It
 * renders the text, marked `data-elide-fallback`, so with fallback.css a
 * server-rendered page shows it truncated before it hydrates.
 *
 * ```jsx
 * <Elided text={path} position="middle" keep={/\.[^.]+$/} className="path" />
 * ```
 */
export function Elided<T extends ElementType = 'div'>(props: ElidedProps<T>): ReactElement {
  const options: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'as') continue;
    if (OPTIONS.has(key)) options[key] = value;
    else attributes[key] = value;
  }
  const [ref] = useElide(options);
  // The text as first rendered, so server-rendered HTML shows it (truncated
  // by fallback.css) before hydrating. It never changes after, so React
  // leaves the content to the instance.
  const [initial] = useState(() => escape(props.text));
  const lines = props.lines ?? 1;
  return createElement(props.as ?? 'div', {
    ...attributes,
    ref,
    'data-elide-fallback': lines > 1 ? String(lines) : '',
    dangerouslySetInnerHTML: { __html: initial },
  });
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
