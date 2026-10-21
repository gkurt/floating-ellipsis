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
bun run smoke         # the packed package, installed with npm and used as a consumer
```

The browser tests need Playwright's engines once:
`bunx playwright install chromium firefox webkit`.

The package ships its TypeScript source (`src/`) next to `dist/`, so
sourcemaps resolve and readers can see the implementation. See
[How it works](docs/how-it-works.md) for the internals.

## Demo

`demo/` holds the home page, `/advanced.html`, the playground and
`/table.html`. The home page plays the video's scenes live, from the same
examples (`demo/examples.ts`); `/advanced.html` shows the features past them
the same way. Each box sweeps its width once as it comes into view, then has a
handle to drag. `/playground.html` is one line with every option on [dialkit](https://github.com/joshpuckett/dialkit)
panels, ink guides and a readout of its state; `window.hero` is the instance,
to try from the console. `/table.html` is a crowded table
(up to 2,500 rows, four truncated cells each, as a `<table>` or grid rows) with
tooltips, a search that keeps and highlights matches, and a switch between ellipses at half the text and in the middle of the cell (unjustified, without repeated marks or snapping: what keeps them nearest their place). `/justify.html` shows each `justify` mode with
`repeat: false` (the default), `0.75` and `1`, on truncations that leave a lot of room (whole words, path
segments), under a slider for the width.

`/video.html` plays a short video of the features, scene by scene (`?scene=N`
starts at one), and `/video-advanced.html` a second one: the table, then the
advanced features, each held longer. `bun run video` and `bun run video:advanced`
record them frame by frame into `out/video/floating-ellipsis.mp4` and
`out/video/floating-ellipsis-advanced.mp4` (1920×1080, 60fps, H.264, for
sharing); they need ffmpeg on the PATH. The README's images in
`.github/assets/` are cut from the first: `hero.gif` is its first 7.2
seconds at 960px wide, and each PNG one frame with the stage cropped
(`crop=1776:652:72:362`, scaled to 1200px wide).

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
and peek, and the Radix and Base UI tooltips open only while text is truncated. It
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

Both wait for the smoke test (`bun run smoke`, `scripts/smoke.ts`): the
package built and packed as the release publishes it, installed with npm into
the app in `test/smoke/` outside the repo, imported in Node without a DOM,
type-checked as Node and bundlers resolve it, bundled by Vite and opened in
Chromium. Pull requests run it too. It needs Node and npm, and Chromium
(`bunx playwright install chromium`).
