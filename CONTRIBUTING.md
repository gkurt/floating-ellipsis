# Contributing

```bash
bun i
bun dev               # demo at http://localhost:4181
bun run test          # unit tests (pure logic)
bun run test:browser  # layout tests in Chromium, Firefox and WebKit
bun run bench         # main-thread time and layouts per scenario (Chromium)
bun run build         # dist/ with type declarations
bun run size          # gzipped size of each entry against its budget
```

The browser tests need Playwright's engines once:
`bunx playwright install chromium firefox webkit`.

The package ships its TypeScript source (`src/`) next to `dist/`, so
sourcemaps resolve and readers can see the implementation. See
[How it works](docs/how-it-works.md) for the internals.

## Demo

`demo/` holds the playground and `/table.html`, a crowded table (up to 2,500
rows, four truncated cells each, as a `<table>` or grid rows) with tooltips and
a search that keeps and highlights matches. In the playground, `window.hero`,
`window.keepExamples` and `window.pathInstances` are live instances to try
from the console.

## Releasing

Releases go through [Tegami](https://tegami.fuma-nama.dev) (config in
`scripts/tegami.mts`). Every change that ships gets a changelog entry in
`.tegami/<slug>.md`: run `bun run tegami`, or write one by hand.

```md
---
packages:
  'floating-ellipsis': minor
---

### Highlighted parts
```

On `main`, the release workflow opens a "chore: release vX.Y.Z" pull request
with the versions and `CHANGELOG.md` updated; merging it publishes to npm
through trusted publishing.
