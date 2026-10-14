# floating-ellipsis

Fluid, balanced ellipsis. Smart text truncation for the DOM. **[Live demo →](https://gkurt.com/floating-ellipsis/)**

- **One line or many.** Clamp to any number of lines.
- **Ellipsis anywhere.** `'start'`, `'middle'`, `'end'`, any position from 0 to
  1, or several positions at once.
- **Keep what matters.** Pin words, patterns or ranges so they stay visible. A
  pinned word in the middle of a cut gets an ellipsis on each side.
- **Balanced spacing.** The visible (ink) gap on both sides of the ellipsis is
  equal. By default it matches the gap between the ellipsis' own dots.
- **Flush ends.** Every line holding an ellipsis ends exactly at the edge of
  the box, with the dots spaced evenly in the slack, so resizing flows
  continuously instead of stepping a glyph at a time.
- **Any ellipsis.** The font's `…`, any string, or drawn dots, bullets, rings
  and squares sized from the font itself.
- **Words and paths.** Cuts can snap to whole words (in any language
  `Intl.Segmenter` knows) or to path segments, dropping as little as they can.
- **Copy-friendly.** Selecting across an ellipsis and copying gives the hidden
  text. Screen readers get the full text.
- **Hooks.** Whether the text is truncated, what each ellipsis hides, the line
  boxes, and the exact ink box of every dot: enough to build tooltips that line
  up letter for letter, or that only respond to the ellipsis.
- **Headless tooltips.** An optional add-on that does exactly that: the full
  text grown out of the line, or just what an ellipsis hides. It brings the
  behaviour (delays, placement, animation, selecting its text) and you bring
  the CSS.
- **Change diffs and transitions.** Glyphs shown and hidden on every resize,
  with their positions, plus an optional add-on that morphs glyphs into the
  nearest dot.
- **Without the DOM.** `elideText` makes the same cuts as a string, for canvas,
  SVG, chart labels, workers or the server.
- **Framework bindings.** A `<elide-text>` element, a React hook and component,
  a Vue directive and a Svelte action.
- **Fast in bulk.** Instances truncate together, so the thousands of cells in a
  table resize with a few shared layouts, and rows far off screen wait until
  they come near.

```js
import { elide } from 'floating-ellipsis';

const t = elide(document.querySelector('.filename'), {
  position: 'middle',
  keep: /\.[^.]+$/, // always show the extension
});

t.truncated; // true
t.state.hidden; // [{ start, end, text }], one per ellipsis
t.ellipsisInk(0); // DOMRect around the first ellipsis' ink
t.destroy(); // restore the original content
```

## Develop

```bash
bun i
bun dev        # demo at http://localhost:4181
bun run test   # unit tests (pure logic)
bun run test:browser  # layout tests in Chromium, Firefox and WebKit
bun run build  # dist/ with type declarations
```

The browser tests need Playwright's engines once:
`bunx playwright install chromium firefox webkit`.

The demo is in `demo/`. In it, `window.hero`, `window.keepExamples` and
`window.pathInstances` are live instances you can try from the console. The
hero's "Keep visible" field takes comma-separated words or `/regex/flags`.
`/table.html` is a crowded table: up to 2,500 rows, four truncated cells each,
as a `<table>` or as grid rows, with draggable columns, timings and a
tooltip on every cut-off cell.

## Options

| Option     | Default      |                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`     | element text | Text to show. Defaults to the element's text, with whitespace collapsed.                                                                                                                                                                                                                                                                                                                                                            |
| `lines`    | `1`          | Maximum number of lines.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `position` | `'end'`      | `'start'`, `'middle'`, `'end'` or a number from 0 to 1. An array such as `[0.33, 0.67]` places several ellipses.                                                                                                                                                                                                                                                                                                                    |
| `keep`     | `null`       | Parts that always stay visible: a string (first match), a RegExp (every match if global), `{ start, end }` string offsets, or an array of these. When they can't all fit, the last ones give way first.                                                                                                                                                                                                                             |
| `ellipsis` | `'…'`        | A string, where each character is a separate mark (`'...'`, `'·····'`). Or drawn marks: `{ shape: 'dot' \| 'bullet' \| 'ring' \| 'square', count?, size?, spacing?, like? }`.                                                                                                                                                                                                                                                       |
| `gap`      | `'dots'`     | Ink gap on both sides of the ellipsis. `'dots'`: the spacing between the ellipsis' own marks. `'natural'`: the average of the font's natural gaps. `'none'`: untouched. Or a number in px, or a string like `'0.1em'` / `'2px'`.                                                                                                                                                                                                    |
| `justify`  | `'dots'`     | Where the leftover space on each line holding an ellipsis goes, so the line ends flush. `'dots'`: every gap (text, marks, text) becomes equal; a single `…` is redrawn as separate dots shaped like its own. `'ellipsis'`: into the two gaps around the ellipsis, equally, keeping the dots' own spacing. `'spread'`: letter-spacing across the line (single-line only; otherwise like `'ellipsis'`). `false`: leave it at the end. |
| `trim`     | `true`       | Drop whitespace next to an ellipsis.                                                                                                                                                                                                                                                                                                                                                                                                |
| `snap`     | `null`       | Move cuts to nicer boundaries: `words()` cuts prose between words, `separators('/\\')` paths at segments. See [Snapping](#snapping).                                                                                                                                                                                                                                                                                                |
| `observe`  | `true`       | Re-truncate on resize (ResizeObserver) and when web fonts load. An element more than a screen away from the viewport puts this off until it comes near, when what it shows meanwhile can't change its height (one line, or several held at their height once truncated).                                                                                                                                                            |
| `glyphs`   | `false`      | Wrap each grapheme in its own element, for per-glyph styling and transitions. Kept glyphs get `data-fp-kept`. Adds DOM; meant for short text.                                                                                                                                                                                                                                                                                       |
| `title`    | `false`      | Put the full text in the element's `title` while it is truncated.                                                                                                                                                                                                                                                                                                                                                                   |
| `copy`     | `'full'`     | What a copied selection holds where it crosses an ellipsis: `'full'` (the hidden text) or `'visible'` (the ellipsis).                                                                                                                                                                                                                                                                                                               |
| `onChange` | —            | Same as `instance.onChange(fn)`.                                                                                                                                                                                                                                                                                                                                                                                                    |

`instance.update(options)` changes any option, including `text`.

Truncating runs in a microtask, together with every other instance's: creating,
updating or refreshing many instances at once costs a few shared layouts rather
than a few each. Reading anything from an instance (`state`, `truncated`,
`marks()`, …) runs its pending pass first, so what you read is always current.

### Drawn marks

```js
elide(el, { ellipsis: { shape: 'bullet' } }); // • • •, sized like the font's •
elide(el, { ellipsis: { shape: 'ring', count: 4 } });
elide(el, { ellipsis: { shape: 'square', size: '0.12em', spacing: 3 } });
elide(el, { ellipsis: { shape: 'dot', like: '…' } }); // the font's … as separate dots
elide(el, { ellipsis: { shape: 'dot', like: '…', count: 5 } }); // five of them
elide(el, { ellipsis: '' }); // no marks, just a balanced gap
```

`count` can be anything from 0 up. With no marks (`count: 0` or `''`), the cut
still leaves a gap the size of the font's dot rhythm, balanced and justified
like any other.

Dots and squares take their size and height from the font's `.`; bullets and
rings from its `•`. The spacing defaults to the font's own ellipsis rhythm,
scaled to the mark size.

### Snapping

```js
import { separators, words } from 'floating-ellipsis';
elide(el, { snap: words() }); // The quick brown…lazy dog, never The quick bro…azy dog
elide(el, { snap: separators('/\\') }); // /Users/ada/Projects/anal…/notes/x.md
elide(el, { snap: separators('/\\', { fragment: 'tail' }) }); // /Users/ada/Projects/…engine/notes/x.md
elide(el, { snap: separators('/\\', { fragment: false }) }); // /Users/ada/…/analytical-engine/notes/x.md
```

`separators(chars)` cuts at separators: a string of characters, or a RegExp a
separator matches. `words()` cuts between words, as `Intl.Segmenter` finds
them, so text written without spaces (Japanese, Thai, …) works too.

Each side of a cut moves to a boundary, and separators next to the cut stay
visible. Moving both sides hides more than the plain cut would, and the room
that frees ends up in the gaps around the ellipsis. So one side may keep a
fragment of its segment instead (`'head'` prefers the start of the segment the
cut begins in, `'tail'` the end of the one it stops in, each falling back to
the other). That fragment takes the room the other side gave up, through as
many segments as it covers, so the cut shows about as much as a plain one.
Less than `min` graphemes (default 3) of a segment is never shown. A side with
no separator in reach keeps the plain cut, and is the fragment.

Where whole segments go (`fragment: false`, the default for `words()`, or when
neither side has room for a fragment), it's the shortest run of whole segments
that hides enough, so as little room as possible is left over. A shorter one a
little further from the cut wins over a longer one right at it (each six
graphemes it moves counts as one more left over), but a cut never moves past
the cuts either side, nor takes the start or end of the text unless it was
already there.

## Instance API

- `state`: `{ text, length, truncated, hidden, kept, lines, gaps, slack }`.
  - `hidden` and `kept` are lists of `{ start, end, text }`, in grapheme indices.
  - `gaps[i]` describes ellipsis `i`: the target, the natural gaps, the final
    gaps (`left`, `inner[]`, `right`) and the `slack` it absorbed.
  - `slack` is the room the lines holding ellipses had before justification:
    small values mean the text is tightly packed.
- `truncated`, `graphemes`, `options`, `markStyle` (the marks actually drawn).
- `ellipsisElement`: the first ellipsis. Stable for the life of the instance,
  so listeners can stay attached. `ellipses`: all showing ellipses.
- `ellipsisIndex(node)`: which ellipsis an event target is in, or -1.
- `ellipsisRect(i)`, `ellipsisInk(i)`: the box, or the tight ink box, of ellipsis `i`.
- `ellipsisArea(i)`: the space ellipsis `i` takes between the text before and after it, gaps included. Where the hidden text would go.
- `graphemeRect(i)`: the box of grapheme `i` as laid out, or null when it's hidden. Works in text mode too, so a tooltip can line its own copy of the text up with the original, glyph by glyph (the [tooltip](#tooltips) add-on does).
- `graphemeAt(node, offset, side?)`: the grapheme index, in the full text, of a DOM position in the element's text (say, either end of a selection), or null. A position inside an ellipsis stands for the start (`side: 'start'`) or end (`'end'`) of what it hides, so a range touching an ellipsis covers all of it, as copying does. The [tooltip](#tooltips) add-on uses it to carry a selection made in the text over to its tip.
- `ellipsisAt(x, y, slop?)`: which ellipsis' area holds a point (e.g. a pointer event's `clientX`/`clientY`), or -1. A better hover target than the ellipsis element, which only spans its marks.
- `marks(i)`: the ink box of every dot, bullet or character of ellipsis `i`.
  For a single `…` glyph, the dots are found inside the glyph.
  `markElements(i)`: the elements drawing them.
- `lineRects()`: one box per rendered line.
- `glyph(i)`, `glyphInk(i)`: the element and ink box of grapheme `i` (glyph mode).
- `onRender(fn)`: called after every layout pass, including resizes that
  leave the visible text as it was. Returns an unsubscribe function.
- `onChange(fn)`: called when the visible text changes. Returns an unsubscribe function.
  The event has `shown` / `hidden` grapheme indices, and where things were as
  last painted: `glyphsBefore` and `hiddenGlyphs` (box and ink of each glyph,
  in glyph mode) and `marksBefore`.
- `refresh()`, `update(options)`, `destroy()`

The element also gets a `data-truncated` attribute, for CSS.

## Text without the DOM

```js
import { elideText } from 'floating-ellipsis/text';

elideText('/Users/ada/Projects/notes/difference-tables.md', {
  width: 180,
  font: '13px Inter',
  position: 'middle',
  keep: /\.[^.]+$/,
}).text; // what fits in 180px, cut in the middle, '.md' kept
```

The same cuts `elide` makes, as a string: for a canvas, an SVG or chart label,
a worker, or the server. It fits one line, measured with a canvas in `font`
(an `OffscreenCanvas` in workers), or with your own `measure(text)` where
there's no canvas or to match another renderer. It sums glyph widths to find
the cut, then measures the result, so kerning is accounted for.

| Option          | Default |                                                                          |
| --------------- | ------- | ------------------------------------------------------------------------ |
| `width`         | —       | The room, in px (or whatever unit `measure` returns).                    |
| `font`          | —       | A CSS font shorthand to measure with a canvas. Needed without `measure`. |
| `measure`       | canvas  | `(text) => width`.                                                       |
| `letterSpacing` | `0`     | Space after every grapheme.                                              |
| `position`      | `'end'` | As in `elide`.                                                           |
| `keep`          | `null`  | As in `elide`.                                                           |
| `ellipsis`      | `'…'`   | A string.                                                                |
| `trim`          | `true`  | Drop whitespace next to an ellipsis.                                     |
| `snap`          | `null`  | `words()`, `separators()`; both are exported from this entry too.        |

It returns `{ text, truncated, hidden, kept, width }`: `hidden` and `kept` as
in an instance's `state`, and the measured `width` of `text`.

## Frameworks

Every binding takes the same options as `elide`, the text included, and keeps
the instance in step as they change: compared by value, so inline arrays and
patterns don't re-truncate on every render, with keys left out going back to
their defaults. The instance owns the element's content, so pass the text as
the `text` option and leave the element empty. A `snap` made inline
(`words()`) is new each time and does re-truncate: make it once.

```html
<script type="module">
  import { define } from 'floating-ellipsis/element';
  define(); // <elide-text>
</script>
<elide-text position="middle" keep="/\.[^.]+$/" snap="paths">/Users/ada/notes/2026/difference-tables.md</elide-text>
```

`<elide-text>` truncates its own text. Its attributes are `lines`, `position`
(`middle`, `0.3`, `0.33 0.67`), `keep` (a string or `/regex/flags`),
`ellipsis`, `gap`, `justify` (`false` turns it off), `trim`, `snap` (`words`,
`paths`, or separator characters), `glyphs`, `tooltip-title` (the `title`
option), `copy` and `text`. The `options` property takes anything `elide` does,
over the attributes, `instance` is the live instance, and it fires
`elidechange` with an `ElideChange` as `detail`. It's a block unless styled
otherwise. `define(name)` registers it under another name.

```jsx
import { Elided, useElide } from 'floating-ellipsis/react';

<Elided text={path} position="middle" className="path" />; // a div; `as` picks another element

function Path({ path }) {
  const [ref, instance] = useElide({ text: path, position: 'middle' });
  return <div ref={ref} />;
}
```

```vue
<script setup>
import { vElide } from 'floating-ellipsis/vue';
</script>
<template><div v-elide="{ text: path, position: 'middle' }" /></template>
```

```svelte
<script>
  import { elide } from 'floating-ellipsis/svelte';
</script>
<div use:elide={{ text: path, position: 'middle' }}></div>
```

React is an optional peer dependency (18 or later); the Vue and Svelte
bindings need nothing from them. `elideOf(el)` from `floating-ellipsis/vue`
gives the instance behind a `v-elide`.

## Transitions

```js
import { elide } from 'floating-ellipsis';
import { transitions } from 'floating-ellipsis/transitions';

const t = elide(el, { position: 0.5, glyphs: true });
const stop = transitions(t, { effect: 'merge' }); // 'fade' | 'blur' | 'merge'
```

| Option     | Default      |                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effect`   | `'merge'`    | `'merge'`, `'fade'`, `'blur'`, or `'none'` (glyphs come and go at once; the dots still glide).                                                                                                                                                                                                                                                                                                                     |
| `duration` | `460`        | Milliseconds for glyph effects, and roughly how long the dots take to settle.                                                                                                                                                                                                                                                                                                                                      |
| `glide`    | `true`       | When the cut changes, the ellipsis' spacing glides instead of jumping. The dots always sit evenly in the space between their neighbouring glyphs; that space's edges glide on a critically damped spring (velocity carries over, no overshoot). An edge only reaches past a glyph that is still on its way in, so the dots never run into the text. Works without glyph mode too.                                  |
| `pace`     | `'leeway'`   | How long glyph effects take. `'leeway'`: leaving glyphs take time in proportion to the room their removal frees, and arriving ones are compressed by how many arrive side by side. Every effect is also capped at three times the interval since the previous change, so a fast drag or slider sweep is instant, and anything still in flight finishes at once instead of piling up. `'fixed'`: always `duration`. |
| `marks`    | `'together'` | When the spacing widens as glyphs leave: `'together'` with them, or `'after'` they have merged, so the dots only spread into the freed space once it is empty.                                                                                                                                                                                                                                                     |

With `'merge'`, a glyph that leaves shrinks into the nearest mark of the
ellipsis: glyphs on the left go into the left dot, glyphs on the right into
the right one, and big jumps spread across the middle dots. On the way it
takes the ellipsis' colour and cross-fades into the mark's shape. Arriving
glyphs grow back out the same way.

Nothing moves the text itself: glyphs keep their layout positions, so the line
always ends exactly at the edge. Ghost glyphs are drawn in an overlay next to
the text, never inside it, and are re-placed after every layout pass. Dots are
shifted with a transform, which is visual only, and only ever within the space
between the visible glyphs on either side, never narrower than they need, so
they can't collide with the text or each other. Only jumps glide; the gentle
drift of a resize follows layout directly. Respects `prefers-reduced-motion`.

## Tooltips

```js
import { elide } from 'floating-ellipsis';
import { tooltip } from 'floating-ellipsis/tooltip';

const tips = tooltip({ reveal: 'grow', breaks: '/\\' });
for (const row of rows) tips.attach(elide(row.querySelector('.path'), { position: 'middle' }), row);
```

A headless tooltip for truncated text. One tooltip serves every instance
attached to it and shows one tip at a time: when a trigger (the instance's
element, or any element around it, say its row) is hovered or focused and its
text is truncated. After the first tip's delay, the next one shows at once, so
moving along a list only makes you wait once. Make one per list or table.

With `reveal: 'grow'`, the tip starts as an exact copy of the line, dots
included, and grows into the full text: every grapheme starts where it is on
screen and the hidden ones come out of their ellipsis, however many there are.
Its text starts where the line's does and runs right. Past the window's edge,
or past `maxWidth` (half the window, or the line's width if that's wider), it
wraps (after `breaks`, where it can), and only when that would leave it
narrower than `aspect` (2, width to height) does it widen to the left, as
little as it can. `'expand'` is the same tip
without the animation, and `'peek'` shows only what one ellipsis hides, next
to it, when that ellipsis is hovered.

A press on a full-text tip makes its text selectable: drag to select, press
twice for the run between breaks, three times for all of it. It stays open
while it's hovered or holds a selection. Text selected in the original when
the tip opens is selected in the tip too, all of whatever an ellipsis it
touches hides. Escape, a scroll, a press elsewhere, or a new layout of the
text (a resize) closes it.

| Option       | Default  |                                                                                                                                                                    |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reveal`     | `'grow'` | `'grow'`: the full text, grown out of the line. `'expand'`: the full text over the line, at once. `'peek'`: what one ellipsis hides, on that ellipsis.             |
| `delay`      | `500`    | Milliseconds the pointer rests on a trigger before its tip shows. Focus shows it at once.                                                                          |
| `grace`      | `300`    | While a tip shows, and this many milliseconds after it closes, the next one shows without the delay.                                                               |
| `breaks`     | `''`     | Characters a full-text tip may wrap after, as well as at spaces: `'/\\'` for paths. A double press selects the run between them.                                   |
| `maxWidth`   | `0.5`    | The widest a full-text tip gets, as a fraction of the window's width, unless the line it covers is wider.                                                          |
| `aspect`     | `2`      | A full-text tip wraps at the window's edge, where its text starts, while it's at least this many times as wide as it's tall; any narrower, it widens to the left.  |
| `edge`       | `8`      | How close the tip comes to the edges of the window, in px.                                                                                                         |
| `offset`     | `8`      | `'peek'`: the distance between the ellipsis' ink and the tip, in px.                                                                                               |
| `slop`       | `4`      | `'peek'`: how far around an ellipsis' area (see `ellipsisAt`) still counts as on it, in px.                                                                        |
| `selectable` | `true`   | A press on a full-text tip selects its text, and holds the tip open.                                                                                               |
| `duration`   | `460`    | `'grow'`: milliseconds; `easing` sets its curve. No motion when the user prefers reduced motion (`respectReducedMotion`, default true).                            |
| `container`  | `<body>` | The element the tip goes in. Put it in a modal `<dialog>` to show tips for text inside it, since the dialog is drawn above the page. Can be changed with `update`. |
| `onShow`     | —        | Called with `{ instance, trigger, ellipsis }` when a tip opens. `ellipsis` is the index of the peeked ellipsis, or null.                                           |
| `onHide`     | —        | Called with the same when it closes.                                                                                                                               |

- `attach(instance, trigger?)`: show `instance`'s tips when `trigger` (default:
  its element) is hovered or focused. Returns a function that detaches it.
  Listeners are shared, so attaching every cell of a table is cheap.
- `show(instance, ellipsis?)`, `hide()`: open or close a tip yourself.
- `update(options)`, `destroy()`, `element` (the tip), `target` (what it
  shows), `held`.

### Styling

The tooltip lays the tip out and leaves how it looks to you. It's a
`position: fixed` element in `container`, with `aria-hidden` (screen readers
already get the full text). It lines up even when the container is the
containing block of fixed elements (it has a transform, filter or `contain`),
as long as it isn't scaled or rotated. A full-text tip takes the text's font, so
its glyphs land on the original's; give a peek tip a font of your own. Its
padding is yours too: the tip is placed so its text, not its box, sits on the
line.

| Hook                           |                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `[data-fp-tip]`                | The tip. Its value is the reveal: `'grow'`, `'expand'` or `'peek'`. `hidden` while closed.                               |
| `[data-fp-tip-bg]`             | Its background, a layer of its own so it can grow without reflowing the text. Give it the background, border and shadow. |
| `[data-fp-tip] [data-fp-mark]` | The ellipsis marks a growing tip fades out from.                                                                         |
| `[data-side]`                  | `'peek'`: `'top'` or `'bottom'`, where the tip is (above the ellipsis unless there's no room).                           |
| `--fp-tip-anchor`              | `'peek'`: the x of the ellipsis' centre from the tip's left edge, for an arrow.                                          |
| `[data-held]`                  | The tip is held (pressed, or holding a selection).                                                                       |
| `[data-fp-tip-open]`           | On the trigger whose tip shows, and in `'peek'` on the ellipsis.                                                         |

```css
[data-fp-tip] {
  z-index: 10;
  padding: 4px 10px;
  color: white;
}
[data-fp-tip-bg] {
  background: #222;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.2);
}
[data-fp-tip='peek'] {
  font:
    13px/18px ui-monospace,
    monospace;
  max-width: min(420px, 90vw);
}
[data-fp-tip='peek']::after {
  content: '';
  position: absolute;
  top: 100%;
  left: var(--fp-tip-anchor);
  translate: -50%;
  border: 6px solid transparent;
  border-top-color: #222;
}
```

## How it works

1. **Fit.** The text is rendered into the element and measured with
   `getClientRects()`, so every CSS property that affects layout is respected.
   A search finds the most graphemes that fit in `lines` lines. It starts from
   what the summed glyph widths say fits, shifted by how far off that was last
   time, so it usually only has to confirm it. On one line, a cut close to one
   already measured is judged from the glyph widths alone when it clears the
   edge by a safe margin (a tenth of an em), so a resize often needs a single
   layout. The full text is only tried when its summed glyph widths could fit.
2. **Islands.** With N ellipses, the kept text forms N + 1 islands: the first
   anchored at the start, the last at the end, and the ones in between centred
   where they sit in the text. Kept graphemes are handed out one at a time in
   proportion to the positions, so every island only grows as space grows. Kept
   parts are added on top, and each gap left over becomes an ellipsis. A gap
   beside a kept part that would hide three letters or fewer is shown instead,
   and the room it takes comes out of the nearest other gap. A gap no wider
   than the ellipsis that would replace it is shown too.
3. **Balance.** Glyphs are measured on a canvas at 128px and scaled down,
   because browsers round glyph boxes to whole pixels. The gaps between ink
   edges are computed with kerning ignored, and margins on the ellipsis make
   both gaps equal the target. The ellipsis is also drawn on a canvas and
   scanned for the empty columns between its dots, which gives the dot rhythm
   and the position of each dot.
4. **Justify.** Whatever space is left on each line holding an ellipsis goes
   into its gaps (or the letter-spacing), line by line from the top, backing
   off by a fraction of a pixel if layout rounding would make the line wrap.
   Filling a line exactly up to the edge keeps its line break where it was.
5. **Stability.** While truncated, the ellipsis keeps its place in the DOM and
   only its neighbours change. Re-inserting it would restart animations and
   reset hover state on every resize. When truncating changes the element's
   height inside the resize observer's callback, the observer looks away for
   a frame, so browsers don't report a "ResizeObserver loop" error.
   The element's height also stays put while you resize it. Before the
   observer runs, the browser lays out the old text at the new width, and a
   line that filled the old width would wrap and grow the element for that
   (unpainted) moment. That's enough for scroll anchoring to fire a scroll
   event on every frame, even far off screen. So a single line never wraps,
   truncated multi-line text holds its height between passes (as an inline
   `height`, restored on `destroy()`), and the probing while fitting happens
   with the height held and overflow clipped.
6. **Batching.** Reading layout after changing the DOM makes the browser lay
   the page out again, and in a long list or table each of those layouts costs
   more with every row: one instance after another, truncating costs the
   square of the row count. So every pass is written to alternate between
   reading and writing, and passes run in lockstep: all of them read, then all
   of them write, and one layout serves them all. One ResizeObserver serves
   every instance, and an IntersectionObserver lets those far off screen wait.
   Inside content that `content-visibility: auto` skips, an instance waits
   until it is rendered. For long lists, that's the fastest setup: rows of
   CSS grid with `content-visibility: auto`, which the browser doesn't lay
   out while they're off screen, whereas a `<table>` lays out every row
   whenever one changes. The demo's table page shows both.

## Accessibility

- Screen readers get the full text from a visually hidden copy; the truncated
  rendering is `aria-hidden`.
- The visible text stays selectable, and copying across an ellipsis gives the
  hidden text (`copy: 'full'`).
- `title: true` adds a native tooltip with the full text while truncated.
- The [tooltip](#tooltips) add-on shows on keyboard focus as well as hover and
  closes on Escape. It's `aria-hidden`, since screen readers already get the
  full text.
- Drawn marks stay visible in forced-colors (high contrast) mode.
- Transitions respect `prefers-reduced-motion`.

## Limits

- Plain text only. Left-to-right text only.
- The element's width must not depend on its content. Use a block, or a flex
  or grid item with `min-width: 0`.
- With several lines, a line holding an ellipsis is filled to the edge even
  when its leftover space comes from a long word wrapping to the next line, so
  the gaps there can get wide.
- Snapping to whole segments still leaves some room over when no run of them
  hides just enough; `justify` spreads it into the gaps around the ellipsis.
  Allowing a fragment (`fragment: 'head'`) leaves almost none.
- `elideText` fits one line.
