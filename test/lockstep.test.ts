import { describe, expect, it } from 'bun:test';
import { Phase, type Pass, lockstep } from '#src/lockstep.ts';

/** A pass that reads and writes `steps` times, logging each as `name:read` / `name:write`. */
function* logging(name: string, steps: number, log: string[]): Pass<string> {
  const phase = new Phase();
  for (let i = 0; i < steps; i++) {
    yield* phase.read();
    log.push(`${name}:read`);
    yield* phase.write();
    log.push(`${name}:write`);
  }
  return name;
}

describe('lockstep', () => {
  it('runs every read before any write, round after round', () => {
    const log: string[] = [];
    const { results } = lockstep([logging('a', 2, log), logging('b', 2, log)]);
    expect(results).toEqual(['a', 'b']);
    expect(log).toEqual(['a:read', 'b:read', 'a:write', 'b:write', 'a:read', 'b:read', 'a:write', 'b:write']);
  });

  it('lets a short pass finish early', () => {
    const log: string[] = [];
    lockstep([logging('a', 1, log), logging('b', 2, log)]);
    expect(log).toEqual(['a:read', 'b:read', 'a:write', 'b:write', 'b:read', 'b:write']);
  });

  it('yields only when the phase changes', () => {
    const log: string[] = [];
    function* reads(): Pass<string> {
      const phase = new Phase();
      yield* phase.read();
      log.push('a:read');
      yield* phase.read();
      log.push('a:read again');
      yield* phase.write();
      log.push('a:write');
      return 'a';
    }
    lockstep([reads(), logging('b', 1, log)]);
    expect(log).toEqual(['a:read', 'a:read again', 'b:read', 'a:write', 'b:write']);
  });

  it('keeps going when a pass throws, and returns the error', () => {
    const log: string[] = [];
    function* failing(): Pass<string> {
      yield* new Phase().write();
      throw new Error('boom');
    }
    const { results, failed } = lockstep([failing(), logging('b', 2, log)]);
    expect(failed?.error).toBeInstanceOf(Error);
    expect(String(failed?.error)).toContain('boom');
    expect(results[1]).toBe('b');
    expect(log).toHaveLength(4);
  });
});
