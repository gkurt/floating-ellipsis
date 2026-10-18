# Contributing

```bash
bun i
bun dev               # demo at http://localhost:4181
bun run test          # unit tests (pure logic)
bun run test:browser  # layout tests in Chromium, Firefox and WebKit
bun run test:next     # the Next.js example, built and tested in real engines
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

`demo/` holds the home page, the playground and `/table.html`. The home page
plays the video's scenes live, from the same examples (`demo/examples.ts`):
each box sweeps its width once as it comes into view, then has a handle to
drag. `/playground.html` is one line with every option on [dialkit](https://github.com/joshpuckett/dialkit)
panels, ink guides and a readout of its state; `window.hero` is the instance,
to try from the console. `/table.html` is a crowded table
(up to 2,500 rows, four truncated cells each, as a `<table>` or grid rows) with
tooltips and a search that keeps and highlights matches. `/autosize.html` shows elements sized by their content (a
chip, a flex item, an inline-block) with and without `autoSize`, under a
slider for the room they have. `/justify.html` shows each `justify` mode with
`repeat: false`, `0.75` (the default) and `1`, on cuts that leave a lot of room (whole words, path
segments), under a slider for the width.

`/video.html` plays a short video of the features, scene by scene (`?scene=N`
starts at one). `bun run video` records it frame by frame into
`out/video/floating-ellipsis.mp4` (1920×1080, 60fps, H.264, for sharing); it
needs ffmpeg on the PATH.

## Next.js example

`examples/next` is a Next.js app (App Router): a file browser in a resizable
window, built from shadcn/ui components that use the React binding (a button,
tooltips on Radix and on Base UI, a table, cards), with `floating-ellipsis/tooltip`
attached through `instanceRef` (`components/tips.ts`). `/` is generated at build time, `/ssr?path=…` renders on each request. It resolves
`floating-ellipsis` to the built `dist/` (tsconfig `paths`), so it runs what an
app installs, `'use client'` included.

`bun run test:next` builds the package, type-checks and builds the app, then
runs Playwright (`examples/next/tests`) against `next start` in Chromium,
Firefox and WebKit and against `next dev` in Chromium: the HTML carries the
text for `fallback.css`, the page hydrates with nothing logged, every instance
fits its box, the window refits what it holds as it's dragged, the tips grow
and peek, and the Radix and Base UI tooltips open only while text is cut. It
uses ports 4191 and 4192 (`bun run --cwd examples/next dev` serves it on 4191).

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
