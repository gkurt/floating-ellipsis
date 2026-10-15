/**
 * How the package's add-ons (geometry, glyph mode, `onChange`) reach inside
 * an instance (see `Inside`), without importing the class itself: an add-on
 * then costs only what it adds. Not public.
 */
import type { Elide, Inside } from './elide.ts';

let reach: (instance: Elide) => Inside;

/** Reach inside `instance`. */
export const inside = (instance: Elide): Inside => reach(instance);

/** Called once, by `Elide`, with how to reach inside an instance. */
export function openUp(fn: (instance: Elide) => Inside): void {
  reach = fn;
}
