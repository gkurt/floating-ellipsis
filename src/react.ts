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
  type ReactNode,
  type Ref,
  type RefCallback,
  Fragment,
  createElement,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { type BindingOptions, Binding } from './bind.ts';
import type { Elide } from './elide.ts';
import { type Suffix, DEFAULTS } from './options.ts';
import { suffix as after } from './suffix.ts';

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

export type ElidedProps<T extends ElementType = 'div'> = Omit<BindingOptions, 'suffix'> & {
  /** The full text. */
  text: string;
  /**
   * Content that follows the text on its last line and is never truncated: a
   * string, any React node (a "Read more" button, a badge), or a `suffix()`
   * from `floating-ellipsis/suffix`. A node is rendered through a portal, and
   * shows once the page has hydrated.
   */
  suffix?: ReactNode | Suffix;
  /** When `suffix` shows: 'always' (default), or only while the text is 'truncated'. */
  showSuffix?: Suffix['show'];
  /** The element to render. Default 'div'. */
  as?: T;
  /** The rendered element, as `asChild` and `render` props pass (Radix, Base UI). React 19. */
  ref?: Ref<HTMLElement>;
  /**
   * The instance, once the element mounts, for the add-ons:
   * `(t) => tips.attach(t)`. A callback may return its cleanup. Keep it stable
   * (outside the component, or `useCallback`): a new one detaches and attaches again.
   */
  instanceRef?: Ref<Elide>;
} & Omit<ComponentPropsWithoutRef<T>, keyof BindingOptions | 'children' | 'as'>;

/**
 * An element (a `div` unless `as` says otherwise) showing `text`, truncated
 * with the rest of the props as options. Other props, and `ref`, go to the
 * element, so it can be the child of `asChild` (Radix) or a `render` prop
 * (Base UI); `instanceRef` gets the instance. It renders the text, marked `data-elide-fallback`, so with
 * fallback.css a server-rendered page shows it truncated before it hydrates.
 *
 * ```jsx
 * <Elided text={path} position="middle" keep={/\.[^.]+$/} className="path" />
 * ```
 */
export function Elided<T extends ElementType = 'div'>(props: ElidedProps<T>): ReactElement {
  const { as, ref: forwarded, instanceRef, text, lines = 1, suffix, showSuffix: show = 'always', ...rest } = props;
  // Where a node suffix is rendered: the instance moves it into place.
  const [slot] = useState(() => (typeof document === 'undefined' ? null : document.createElement('span')));
  // Not while hydrating, which has no portals to match.
  const client = useSyncExternalStore(subscribe, isClient, isServer);
  const node = !isSuffix(suffix) && typeof suffix === 'object' && suffix !== null;
  const options: Record<string, unknown> = {
    text,
    lines,
    suffix: isSuffix(suffix)
      ? suffix
      : typeof suffix === 'string' || typeof suffix === 'number'
        ? after(String(suffix), { show })
        : node && slot
          ? after(slot, { show })
          : null,
  };
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (OPTIONS.has(key)) options[key] = value;
    else attributes[key] = value;
  }
  const [bind, instance] = useElide(options);
  const ref = useHandedOn(bind, forwarded);
  useImperativeHandle(instance ? instanceRef : undefined, () => instance!, [instance]);
  // The text as first rendered, so server-rendered HTML shows it (truncated
  // by fallback.css) before hydrating. It never changes after, so React
  // leaves the content to the instance.
  const [initial] = useState(() => escape(text));
  const element = createElement(as ?? 'div', {
    ...attributes,
    ref,
    'data-elide-fallback': lines === 1 ? '' : String(lines),
    dangerouslySetInnerHTML: { __html: initial },
  });
  if (!node || !slot || !client) return element;
  return createElement(Fragment, null, element, createPortal(suffix, slot));
}

const isSuffix = (v: unknown): v is Suffix => typeof v === 'object' && v !== null && 'place' in v && typeof v.place === 'function';
const subscribe = () => () => {};
const isClient = () => true;
const isServer = () => false;

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
