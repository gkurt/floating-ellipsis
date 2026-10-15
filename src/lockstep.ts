/**
 * Running many layout passes so they share layouts.
 *
 * Reading layout after writing to the DOM makes the browser lay the page out
 * again. In a long list or table that layout costs more with every row, so
 * passes run one after another (each reading after its own writes) cost the
 * square of the row count. Run in lockstep, every pass reads before any of
 * them writes again, and a single layout serves them all.
 */

/** A pass: starts out reading, and yields whenever it switches between reading and writing. */
export type Pass<T> = Generator<void, T, void>;

/** Where a pass is, reading layout or writing to the DOM. Each switch yields. */
export class Phase {
  #writing = false;

  *read(): Generator<void, void, void> {
    if (!this.#writing) return;
    this.#writing = false;
    yield;
  }

  *write(): Generator<void, void, void> {
    if (this.#writing) return;
    this.#writing = true;
    yield;
  }
}

/**
 * Run passes side by side, all reading, then all writing, and so on. A pass
 * that throws doesn't stop the others; the first error is returned.
 */
export function lockstep<T>(passes: Pass<T>[]): { results: (T | undefined)[]; failed: { error: unknown } | null } {
  const results: (T | undefined)[] = [];
  let active = passes.map((pass, i) => ({ pass, i }));
  let failed: { error: unknown } | null = null;
  while (active.length > 0) {
    const next: typeof active = [];
    for (const a of active) {
      try {
        const step = a.pass.next();
        if (step.done) results[a.i] = step.value;
        else next.push(a);
      } catch (error) {
        failed ??= { error };
      }
    }
    active = next;
  }
  return { results, failed };
}
