# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
bun dev            # Demo at http://localhost:4181 (Vite, serves demo/)
bun run test       # Unit tests (pure logic, no DOM)
bun typecheck      # Type check (TypeScript 7, native tsc)
bun run build      # dist/ via tsdown (index + transitions entries, with .d.ts)
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
- `src/elide.ts` — the `Elide` class: reads the element, fits the text to `lines`, renders ellipses, justifies, and exposes state/geometry hooks (`ellipsisInk`, `marks`, `lineRects`, `onChange`).
- `src/cut.ts` — pure range math: where ellipses go (`position`), what stays (`keep`), `separators()` snapping, and the `searchMax` fit search.
- `src/metrics.ts` — glyph measurement (canvas) and the balanced-gap math (`inkGap`, `planGap`). Kerning is ignored on purpose.
- `src/marks.ts` — what an ellipsis is made of: characters of a string, or drawn dots/bullets/rings/squares sized from the font.
- `src/graphemes.ts` — grapheme splitting; every index in state is a grapheme index.
- `src/transitions.ts` — optional add-on (`floating-ellipsis/transitions`): animates glyphs entering/leaving (merge, fade, blur) from `ElideChange` diffs.
- `demo/` — the Vite demo page plus tooltip helpers (`grow-tip`, `tip-select`, `tip-delay`) built on the public hooks.
- `test/` — `bun test` suites for `cut` and `metrics`.

## Architecture

- Pure logic (`cut`, the math in `metrics`) is DOM-free and unit-tested; `elide.ts` is the only part that touches layout, and the demo is how it's verified.
- A layout pass searches for the most visible graphemes that still fit in `lines`, then plans the ink gap on each side of every ellipsis and spreads leftover slack so ellipsis lines end flush with the box.
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
