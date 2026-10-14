# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
bun dev            # Demo at http://localhost:4181 (Vite, serves demo/)
bun run test       # Unit tests (pure logic, no DOM)
bun typecheck      # Type check (TypeScript 7, native tsc)
bun run build      # dist/ via tsdown (index + transitions entries, with .d.ts)
bun run build:site # Demo as a static site in out/site (deployed to GitHub Pages)
bun run lint       # Lint
bun run format     # Format
bun run fix        # Lint + format + autofix
bun run checks     # Everything: check + typecheck + test
```

Prefer these scripts over ad-hoc commands. Do not prefix them with `bun run` when
a bare alias exists (`bun check`, `bun typecheck`) — those are whitelisted for
agent use. Before finishing, run `bun run fix` then `bun run checks` — the linter,
formatter and `tsc` own all mechanical style rules. Fix the code; don't disable rules.

## Project Structure

- `src/index.ts` — public entry; re-exports `elide`/`Elide`, cut helpers, metrics and types.
- `src/elide.ts` — the `Elide` class: reads the element, fits the text to `lines`, renders ellipses, schedules passes (shared ResizeObserver/IntersectionObserver, microtask batches), and exposes state/geometry hooks (`ellipsisInk`, `marks`, `lineRects`, `onChange`).
- `src/options.ts` — the public option, state and change types, and the option defaults.
- `src/lockstep.ts` — runs many passes so they share layouts: each pass is a generator that yields when it switches between reading and writing (`Phase`).
- `src/justify.ts` — fills the lines holding ellipses to the edge (a pass step).
- `src/predict.ts` — judges single-line cuts from glyph widths and one measurement, so they needn't be rendered.
- `src/lines.ts` — reading the line boxes of laid-out inline text.
- `src/document.ts` — document-wide hooks: copying across an ellipsis, re-truncating when fonts load, the instance registry.
- `src/cut.ts` — pure range math: where ellipses go (`position`), what stays (`keep`), `separators()` snapping, the `searchMax`/`searchSteps` fit search and its `estimateKept` starting point.
- `src/metrics.ts` — glyph measurement (canvas) and the balanced-gap math (`inkGap`, `planGap`). Kerning is ignored on purpose.
- `src/marks.ts` — what an ellipsis is made of: characters of a string, or drawn dots/bullets/rings/squares sized from the font.
- `src/graphemes.ts` — grapheme splitting; every index in state is a grapheme index.
- `src/transitions.ts` — optional add-on (`floating-ellipsis/transitions`): animates glyphs entering/leaving (merge, fade, blur) from `ElideChange` diffs.
- `demo/` — the Vite demo: the playground (`index.html`, `main.ts`) with tooltip helpers (`grow-tip`, `tip-select`, `tip-delay`) built on the public hooks, a crowded table (`table.html`, `table.ts`) for performance, with the same grow tooltips, and shared UI helpers (`ui.ts`).
- `test/` — `bun test` suites for `cut`, `metrics` and `lockstep`.

## Architecture

- Pure logic (`cut`, the math in `metrics`) is DOM-free and unit-tested; `elide.ts` is the only part that touches layout, and the demo is how it's verified.
- A layout pass searches for the most visible graphemes that still fit in `lines`, then plans the ink gap on each side of every ellipsis and spreads leftover slack so ellipsis lines end flush with the box.
- Passes are generators run in lockstep (`lockstep.ts`): all instances read layout, then all write, so N instances share each layout instead of forcing their own. Never read layout in a write phase or write in a read phase; `yield* phase.read()` / `phase.write()` before each. Passes are queued and flushed in a microtask; public getters call `sync()` to flush first.
- Measure performance on the demo's table page (`/table.html`) and with many instances; a single instance hides layout costs that grow with the page.
- Each update emits an `ElideChange` (graphemes shown/hidden, previous boxes); `transitions` only consumes these, so it stays a separate entry point.
- Imports from parent directories go through the `#src/` subpath alias (`package.json` `imports`), with `.ts` extensions.

## Coding Conventions

- Prefer colocation.
- Avoid verbose code comments; write self-explanatory code. Comments are acceptable for:
  - Explaining complex logic, workarounds, or decisions
  - Documenting public APIs (functions, classes, modules)
  - TODO/FIXME notes
  - When the user specifically asks for comments
- Prefer early returns and guard clauses over nested conditionals.
- Check for existing utilities/hooks/components before creating new ones. Avoid duplication.
- Remove dead and commented-out code; don't preserve old APIs unless asked.
- When moving or relocating code (functions, components, utilities), don't leave a re-export behind for backwards compatibility. Update every importer to point at the new location and delete the old definition, so there is a single source of truth.

## Documentation

When changing user-facing APIs, update all relevant docs in the same change:
docs pages, README.md, SKILL.md, AGENTS.md, llms.txt. Documentation must not go stale.
