# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
bun dev            # Demo at http://localhost:4181 (Vite, serves demo/)
bun run test       # Unit tests (pure logic, no DOM)
bun run test:browser # Layout tests in Chromium, Firefox and WebKit (Vitest browser mode + Playwright)
bun run tegami     # Write a changelog entry (.tegami/<slug>.md) interactively
bun typecheck      # Type check (TypeScript 7, native tsc)
bun run build      # dist/ via tsdown (one entry per subpath export, with .d.ts)
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
After touching `elide`, `justify`, `lines`, `marks`, `tooltip`, `transitions`, `text` or a binding, also
run `bun run test:browser` (first time: `bunx playwright install chromium firefox webkit`).

## Project Structure

- `src/index.ts` — public entry; re-exports `elide`/`Elide`, cut helpers, metrics and types.
- `src/elide.ts` — the `Elide` class: reads the element, fits the text to `lines`, renders ellipses, schedules passes (shared ResizeObserver/IntersectionObserver, microtask batches), and exposes state/geometry hooks (`ellipsisInk`, `marks`, `lineRects`, `onChange`).
- `src/options.ts` — the public option, state and change types, and the option defaults.
- `src/lockstep.ts` — runs many passes so they share layouts: each pass is a generator that yields when it switches between reading and writing (`Phase`).
- `src/justify.ts` — fills the lines holding ellipses to the edge (a pass step).
- `src/predict.ts` — judges single-line cuts from glyph widths and one measurement, so they needn't be rendered.
- `src/lines.ts` — reading the line boxes of laid-out inline text.
- `src/document.ts` — document-wide hooks: copying across an ellipsis, re-truncating when fonts load, the instance registry.
- `src/cut.ts` — pure range math: where ellipses go (`position`), what stays (`keep`), `separators()`/`words()` snapping (one segment engine; whole segments go by `fewestSegments`, the shortest run that hides enough), the `searchMax`/`searchSteps` fit search and its `estimateKept` starting point.
- `src/metrics.ts` — glyph measurement (canvas) and the balanced-gap math (`inkGap`, `planGap`). Kerning is ignored on purpose.
- `src/marks.ts` — what an ellipsis is made of: characters of a string, or drawn dots/bullets/rings/squares sized from the font.
- `src/graphemes.ts` — grapheme splitting; every index in state is a grapheme index.
- `src/transitions.ts` — optional add-on (`floating-ellipsis/transitions`): animates glyphs entering/leaving (merge, fade, blur) from `ElideChange` diffs.
- `src/tooltip.ts` — optional add-on (`floating-ellipsis/tooltip`): a headless tooltip on the public instance API. Shows the full text grown from the line, or what one ellipsis hides; owns delays, placement, the grow animation and selecting text in the tip, and leaves the looks to CSS (`data-fp-tip*` hooks).
- `demo/` — the Vite demo: the playground (`index.html`, `main.ts`), a crowded table (`table.html`, `table.ts`) for performance and search highlights, both with tooltips, and shared UI helpers (`ui.ts`).
- `scripts/tegami.mts` — Tegami release config; `.tegami/` holds pending changelog entries; `.github/workflows/release.yml` (+ the `tegami-pr*.yml` preview pair) versions and publishes.
- `src/text.ts` — optional add-on (`floating-ellipsis/text`): `elideText`, the same cuts as a string with no DOM (one line, canvas or custom `measure`).
- `src/bind.ts` — `Binding`, shared by the framework bindings: keeps an instance in step with options handed over whole each time (compared by value, `onChange` as one subscription).
- `src/element.ts`, `src/react.ts`, `src/vue.ts`, `src/svelte.ts` — framework bindings (`floating-ellipsis/element|react|vue|svelte`): `<elide-text>` (`define()`), `useElide`/`Elided`, `vElide`, the `elide` action. React is an optional peer; Vue and Svelte bindings import nothing from them.
- `test/` — `bun test` suites for `cut`, `metrics`, `lockstep` and `text` (`elideText` with a fake `measure`).
- `test/browser/` — Vitest browser-mode suites (`*.browser.ts`) for `elide`, highlights, `tooltip`, `transitions`, the bindings (with `elideText` against real fonts) and Unicode (scripts and emoji under many option combinations), run in Chromium, Firefox and WebKit through Playwright (`vitest.config.ts`). `helpers.ts` holds fixtures that clean up after each test and layout readings (content box, ink gaps, rendered text) and assertions (`expectFits`, `expectConsistent`, `expectFlush`, `sweep`). `vitest.config.ts` adds two commands: `mouse` (real pointer at frame coordinates) and `reducedMotion`.

## Architecture

- Pure logic (`cut`, the math in `metrics`) is DOM-free and unit-tested with `bun test`. Layout is tested in real engines (`test/browser/`) by invariants that hold whatever fonts an engine maps to: lines fit the content box, ellipsis lines end flush, gaps balance, a wider box never shows less, and the tooltip's glyphs land on the line's. The demo is for looking.
- A test failing in one engine because of a bug found there is marked `knownBug(engine)` from `helpers.ts` (an expected failure, so CI turns red once it's fixed), with the bug described in a comment by the test. Don't loosen an invariant to make an engine pass.
- A layout pass searches for the most visible graphemes that still fit in `lines`, then plans the ink gap on each side of every ellipsis and spreads leftover slack so ellipsis lines end flush with the box.
- Passes are generators run in lockstep (`lockstep.ts`): all instances read layout, then all write, so N instances share each layout instead of forcing their own. Never read layout in a write phase or write in a read phase; `yield* phase.read()` / `phase.write()` before each. Passes are queued and flushed in a microtask; public getters call `sync()` to flush first.
- Measure performance on the demo's table page (`/table.html`) and with many instances; a single instance hides layout costs that grow with the page.
- Each update emits an `ElideChange` (graphemes shown/hidden, previous boxes); `transitions` only consumes these, so it stays a separate entry point. `tooltip` likewise only uses the public instance API.
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

## Releases

Every change that ships in the package needs a changelog entry, `.tegami/<slug>.md`
(see the `changelog` skill in `.claude/skills/`). Tooling, tests and demo-only
changes don't. Never edit `version` or `CHANGELOG.md` by hand: the release PR does.

## Documentation

When changing user-facing APIs, update all relevant docs in the same change:
docs pages, README.md, SKILL.md, AGENTS.md, llms.txt. Documentation must not go stale.
