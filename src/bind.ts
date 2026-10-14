/**
 * Keeping an instance in step with options handed over whole, again and
 * again, as frameworks do: only what changed is updated, a key left out goes
 * back to its default, and `onChange` is a subscription, not a pile of them.
 */
import { type Elide, elide } from './elide.ts';
import { type ElideChange, type ElideOptions, DEFAULTS } from './options.ts';

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/** Equal as options go: the same lists, patterns and offsets count as the same. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;
  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => same(a[k], b[k]));
}

const defaults = new Map<string, unknown>(Object.entries(DEFAULTS));

export class Binding {
  readonly instance: Elide;
  private applied: ElideOptions;
  private unsubscribe: (() => void) | null = null;
  private listener: ElideOptions['onChange'];

  constructor(element: HTMLElement, options: ElideOptions = {}) {
    const { onChange, ...rest } = options;
    this.instance = elide(element, rest);
    this.applied = rest;
    this.listen(onChange);
  }

  /** Make the instance match `options`, as if it had been created with them. */
  set(options: ElideOptions = {}): void {
    const { onChange, ...rest } = options;
    this.listen(onChange);
    const before = new Map<string, unknown>(Object.entries(this.applied));
    const after = new Map<string, unknown>(Object.entries(rest));
    const changed: Record<string, unknown> = {};
    let any = false;
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      if (same(before.get(key), after.get(key))) continue;
      changed[key] = after.get(key) ?? defaults.get(key);
      any = true;
    }
    this.applied = rest;
    if (any) this.instance.update(changed);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.instance.destroy();
  }

  private listen(fn: ((change: ElideChange) => void) | undefined) {
    if (fn === this.listener) return;
    this.unsubscribe?.();
    this.listener = fn;
    this.unsubscribe = fn ? this.instance.onChange(fn) : null;
  }
}
