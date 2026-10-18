# floating-ellipsis

Fluid, balanced ellipsis. Smart text truncation for the DOM. **[Live demo →](https://gkurt.com/floating-ellipsis/)**

- **Anywhere, any length.** Clamp to any number of lines, with the ellipsis at
  the start, middle, end, any position, or several at once.
- **Balanced and flush.** Even spacing on both sides of the ellipsis, and lines
  that end exactly at the edge, so resizing flows instead of stepping.
- **Keep what matters.** Pin words, patterns or ranges so they stay visible,
  and highlight them.
- **Words and paths.** Cuts can snap to whole words or path segments.
- **Rich text.** Links and inline markup survive the cut; a suffix ("Read
  more", a badge) follows the text and is never cut.
- **Native behaviour.** Find in page finds hidden text, copying gives the full
  text, screen readers read it all.
- **Add-ons.** Headless tooltips, glyph transitions, a DOM-free `elideText`, a
  CSS fallback, and bindings for custom elements, React, Vue and Svelte.
- **Fast in bulk.** Thousands of instances share a few layouts.

```bash
npm i floating-ellipsis
```

```js
import { elide } from 'floating-ellipsis';

const t = elide(document.querySelector('.filename'), {
  position: 'middle',
  keep: /\.[^.]+$/, // always show the extension
});

t.truncated; // true
t.state.hidden; // [{ start, end, text }], one per ellipsis
t.destroy(); // restore the original content
```

The element's width must not depend on its content: use a block, or a flex or
grid item with `min-width: 0`. For one whose width does (a chip, an
inline-block), see [Sized by content](#sized-by-content).

## Options

| Option     | Default         |                                                                                                                                                     |
| ---------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`     | element content | A string, or a node whose text and inline elements are shown.                                                                                       |
| `lines`    | `1`             | Maximum number of lines.                                                                                                                            |
| `position` | `'end'`         | `'start'`, `'middle'`, `'end'`, a number from 0 to 1, or an array of them for several ellipses.                                                     |
| `keep`     | `null`          | Parts that stay visible: a string, a RegExp, `{ start, end }`, or an array. `{ match, class }` / `{ start, end, class }` also highlight them.       |
| `ellipsis` | `'…'`           | A string (each character is a mark), or drawn marks: `{ shape: 'dot' \| 'bullet' \| 'ring' \| 'square', count?, size?, spacing?, like? }`.          |
| `gap`      | `'dots'`        | Ink gap beside the ellipsis: `'dots'` (its own dot spacing), `'natural'`, `'none'`, px, or a CSS length.                                            |
| `justify`  | `'dots'`        | Where leftover room goes so lines end flush: `'dots'` (all gaps equal), `'ellipsis'` (the two outer gaps), `'spread'` (letter-spacing), or `false`. |
| `maxGap`   | `'0.75em'`      | The widest a justified gap gets; room past it stays at the line's end. `null`: no limit.                                                            |
| `trim`     | `true`          | Drop whitespace next to an ellipsis.                                                                                                                |
| `snap`     | `null`          | `words()` or `separators(chars)`. See [Snapping](#snapping).                                                                                        |
| `observe`  | `true`          | Re-truncate on resize and when web fonts load.                                                                                                      |
| `glyphs`   | `null`          | `glyphs` from `floating-ellipsis/glyphs`: each grapheme in its own element, for per-glyph styling and transitions. Meant for short text.            |
| `title`    | `false`         | Put the full text in `title` while truncated.                                                                                                       |
| `copy`     | `'full'`        | What copying across an ellipsis gives: `'full'` (the hidden text) or `'visible'`.                                                                   |
| `suffix`   | `null`          | `suffix(content)` from `floating-ellipsis/suffix`. See [Suffixes](#suffixes).                                                                       |
| `find`     | `'keep'`        | Find in page on hidden text: `'keep'` reveals the matched word, `'expand'` expands the text, `false` leaves it out (lighter in crowded tables).     |
| `autoSize` | `null`          | `autoSize()` from `floating-ellipsis/autosize`, for an element whose width comes from its content. See [Sized by content](#sized-by-content).       |

`instance.update(options)` changes any option, including `text`.

### Drawn marks

```js
elide(el, { ellipsis: { shape: 'bullet' } }); // • • •, sized like the font's •
elide(el, { ellipsis: { shape: 'square', size: '0.12em', spacing: 3 } });
elide(el, { ellipsis: { shape: 'dot', like: '…', count: 5 } }); // the font's … as five dots
elide(el, { ellipsis: '' }); // no marks, just a balanced gap
```

Marks are sized from the font: dots and squares from its `.`, bullets and rings
from its `•`.

### Highlights

```js
elide(el, { position: 'middle', keep: { match: /engine/gi, class: 'hit' } });
```

Matches stay visible and are wrapped in a `<span>` with the class (and
`data-fp-kept`). A highlight split by an ellipsis marks its pieces with
`data-fp-open` (`start`, `end`), so rounded corners can stay on the outer ends:

```css
.hit[data-fp-open~='start'] {
  border-start-start-radius: 0;
  border-end-start-radius: 0;
}
```

### Snapping

```js
import { separators, words } from 'floating-ellipsis';
elide(el, { snap: words() }); // The quick brown…lazy dog
elide(el, { snap: separators('/\\') }); // /Users/ada/Projects/anal…/notes/x.md
elide(el, { snap: separators('/\\', { fragment: false }) }); // /Users/ada/…/analytical-engine/notes/x.md
```

`words()` cuts between words in any language `Intl.Segmenter` knows.
`separators(chars)` takes a string of characters or a RegExp. By default one
side of a path cut keeps a piece of its segment (`fragment: 'head'`, or
`'tail'`), so the cut shows about as much as a plain one; with `false` only
whole segments go, as with `words()`.

### Markup

```js
elide(document.querySelector('.post'), { lines: 3 }); // links, code, emphasis kept
```

Inline elements are copied around whatever part of them shows. The copies have
no `id` or listeners, so listen on the element or above it. Keyboard focus goes
to the full text's links; their copies in the line get `data-fp-focus` for a
focus ring. Images and icons are dropped.

### Suffixes

```js
import { suffix } from 'floating-ellipsis/suffix';

const more = document.createElement('button');
more.textContent = 'Read more';
const post = elide(el, { lines: 3, suffix: suffix(more, { show: 'truncated' }) });
more.onclick = () => (post.expanded ? post.collapse() : post.expand());
```

The content is a string or a node, which follows the text on its last line and
is never cut. A node is moved into place, keeping its listeners, and goes back
on `destroy()`. `show` is `'always'` (default) or `'truncated'`. `expand()`
shows all of the text until `collapse()`.

### Sized by content

```js
import { autoSize } from 'floating-ellipsis/autosize';

// .chip { display: inline-block; max-width: 100%; }
elide(chip, { position: 'middle', autoSize: autoSize() });
```

An inline-block, a float, an absolutely positioned element, or a flex or grid
item sized by its content takes its width from the text that shows, so once
cut it never grows back. With `autoSize()`, an invisible copy of the full text
(with its elements, and a suffix that always shows) sizes it instead: as wide
as the text, up to the room it has. On one line, as with `text-overflow`,
something must cap that room: `max-width: 100%`, or `min-width: 0` on a flex
item.

### Find in page

Hidden text is still found by the browser's find in page (where
`hidden="until-found"` is supported). With `find: 'keep'`, the matched word is
kept visible and marked `data-fp-match`; with `'expand'`, the text expands.
Either lasts until a press outside the text or a match elsewhere.

```css
[data-fp-match] {
  background: Mark;
  color: MarkText;
}
```

## Instance API

- `state`: `{ text, length, truncated, expanded, hidden, kept, lines, gaps, slack }`.
  `hidden` and `kept` are `{ start, end, text }` lists in grapheme indices.
- `truncated`, `expanded`, `graphemes`, `options`, `markStyle`, `classOf(i)`.
- `ellipsisElement` (the first, stable for the instance's life), `ellipses`.
- `onRender(fn)`: after every layout pass. Returns an unsubscribe function.
- `expand()`, `collapse()`, `refresh()`, `update(options)`, `destroy()`.

The element gets `data-truncated`, and `data-fp-expanded` while expanded.
Passes are batched in a microtask; reading anything from an instance flushes
its pending pass first.

Separate entries, so pages that don't use them don't ship them:

```js
import { onChange } from 'floating-ellipsis/changes';
import { ellipsisRect, graphemeAt } from 'floating-ellipsis/geometry';
import { glyph, glyphInk } from 'floating-ellipsis/glyphs';

ellipsisRect(t, 0); // a DOMRect, in viewport coordinates
const stop = onChange(t, ({ shown, hidden }) => {}); // when the visible text changes
```

- `floating-ellipsis/geometry`: `ellipsisRect(t, i)`, `ellipsisInk(t, i)`,
  `ellipsisArea(t, i)`, `markInks(t, i)`, `markElements(t, i)`: boxes of an
  ellipsis and its marks. `graphemeRect(t, i)`, `graphemeAt(t, node, offset, side?)`,
  `lineRects(t)`, `ellipsisIndex(t, node)`, `ellipsisAt(t, x, y, slop?)`.
- `floating-ellipsis/changes`: `onChange(t, fn)`, with `shown`/`hidden`
  indices and where glyphs and marks were painted before. Bindings take it as
  the `onChange` option.
- `floating-ellipsis/glyphs`: in glyph mode, `glyph(t, i)` and `glyphInk(t, i)`.

## Before scripts run

```js
import 'floating-ellipsis/fallback.css';
```

```html
<div data-elide-fallback>/Users/ada/notes/2026/difference-tables.md</div>
<p data-elide-fallback="2">Clamped to two lines with CSS until an instance takes over.</p>
```

CSS can only cut at the end. React's `<Elided>` renders this markup itself, so
server-rendered pages show truncated text before hydration.

## Text without the DOM

```js
import { elideText } from 'floating-ellipsis/text';

elideText(path, { width: 180, font: '13px Inter', position: 'middle', keep: /\.[^.]+$/ }).text;
```

The same cuts as a string, on one line, for canvas, SVG, workers or the server.
It takes `width`, `font` or your own `measure(text)`, `letterSpacing`, and
`position`, `keep`, `ellipsis` (a string), `trim` and `snap` as in `elide`. It
returns `{ text, truncated, hidden, kept, width }`.

## Frameworks

Bindings take the same options as `elide` and keep the instance in step,
comparing by value. Pass the text as the `text` option and leave the element
empty. Create a `snap` once, not inline.

```html
<script type="module">
  import { define } from 'floating-ellipsis/element';
  define(); // <elide-text>
</script>
<elide-text position="middle" keep="/\.[^.]+$/" snap="paths">/Users/ada/notes/2026/difference-tables.md</elide-text>
```

`<elide-text>` takes most options as kebab-case attributes (`tooltip-title`
for `title`, `keep-class` to highlight `keep`, `snap="words|paths"`, `auto-size`), or all of
them through its `options` property. A child with `slot="suffix"` is its suffix. It exposes
`instance` and fires `elidechange`.

```jsx
import { Elided, useElide } from 'floating-ellipsis/react';

<Elided text={path} position="middle" className="path" />;

function Path({ path }) {
  const [ref] = useElide({ text: path, position: 'middle' });
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

React (18+) is an optional peer dependency. In virtual lists, either recycle
instances with `update({ text })` or mount one per row; both cost the same.

### Next.js and shadcn/ui

`floating-ellipsis/react` is a Client Component (`'use client'`), so Server
Components render `<Elided>` as is. With `fallback.css` imported in the layout,
static and server-rendered pages show the text cut at the end until they
hydrate. Props from a Server Component must serialize: `keep` as a string, not
a RegExp; set `snap`, `onChange`, `glyphs` and `suffix` in a Client Component.

`<Elided>` passes its `ref` (React 19) and other props to its element, so it can be the
child of a Radix `asChild` or a Base UI `render` prop:

```tsx
<Button variant="outline" className="w-72">
  <FileText />
  <Elided as="span" text={path} position="middle" className="min-w-0 flex-1 text-left" />
</Button>

<TooltipTrigger asChild>
  <Elided ref={trigger} text={path} position="middle" />
</TooltipTrigger>
<TooltipTrigger render={<Elided ref={trigger} text={path} position="middle" />} />
```

In flex rows, give the text `min-w-0 flex-1`; in tables, use `table-fixed`. To
open a tooltip only while the text is cut, check the trigger's `data-truncated`
in `onOpenChange`. [`examples/next`](examples/next) has these as shadcn
components (buttons, Radix and Base UI tooltips, a table), static and
server-rendered.

## Transitions

```js
import { glyphs } from 'floating-ellipsis/glyphs';
import { transitions } from 'floating-ellipsis/transitions';

const t = elide(el, { position: 0.5, glyphs });
const stop = transitions(t, { effect: 'merge' });
```

| Option     | Default      |                                                                                   |
| ---------- | ------------ | --------------------------------------------------------------------------------- |
| `effect`   | `'merge'`    | `'merge'` (glyphs shrink into the nearest dot), `'fade'`, `'blur'` or `'none'`.   |
| `duration` | `460`        | Milliseconds.                                                                     |
| `glide`    | `true`       | The ellipsis' spacing glides when the cut changes. Works without glyph mode.      |
| `pace`     | `'leeway'`   | `'leeway'` scales durations to the change and speeds up fast drags; or `'fixed'`. |
| `marks`    | `'together'` | When the dots spread into freed room: `'together'` with the glyphs, or `'after'`. |

Respects `prefers-reduced-motion`.

## Tooltips

```js
import { tooltip } from 'floating-ellipsis/tooltip';

const tips = tooltip({ reveal: 'grow', breaks: '/\\' });
for (const row of rows) tips.attach(elide(row.querySelector('.path'), { position: 'middle' }), row);
```

A headless tooltip for truncated text, shared by every instance attached to it.
With `reveal: 'grow'` the tip starts as a copy of the line and grows into the
full text; `'expand'` shows it at once; `'peek'` shows only what the hovered
ellipsis hides. Pressing a tip makes its text selectable.

| Option       | Default  |                                                                         |
| ------------ | -------- | ----------------------------------------------------------------------- |
| `reveal`     | `'grow'` | `'grow'`, `'expand'` or `'peek'`.                                       |
| `delay`      | `500`    | Hover delay in ms. Focus shows the tip at once.                         |
| `grace`      | `300`    | After a tip closes, the next one shows without the delay for this long. |
| `breaks`     | `''`     | Characters a tip may wrap after, besides spaces: `'/\\'` for paths.     |
| `maxWidth`   | `0.5`    | Widest tip, as a fraction of the window (or the line's width if wider). |
| `aspect`     | `2`      | Minimum width-to-height ratio before a tip widens leftwards.            |
| `edge`       | `8`      | Distance from the window's edges, in px.                                |
| `offset`     | `8`      | `'peek'`: distance from the ellipsis, in px.                            |
| `slop`       | `4`      | `'peek'`: hover tolerance around the ellipsis, in px.                   |
| `selectable` | `true`   | A press makes the text selectable and holds the tip open.               |
| `duration`   | `460`    | `'grow'` animation length; `easing` sets its curve.                     |
| `container`  | `<body>` | Where the tip goes; use the `<dialog>` for text inside a modal.         |
| `onShow`     | —        | Called with `{ instance, trigger, ellipsis }`.                          |
| `onHide`     | —        | Called with the same.                                                   |

`attach(instance, trigger?)` returns a detach function; `show(instance,
ellipsis?)`, `hide()`, `update(options)` and `destroy()` do what they say.

The looks are yours. Style `[data-fp-tip]` (padding, colour; its value is the
reveal) and `[data-fp-tip-bg]` (background, border, shadow). A peek tip has
`data-side` (`top`/`bottom`) and `--fp-tip-anchor` for an arrow; a held tip
has `data-held`; the open trigger has `data-fp-tip-open`.

```css
[data-fp-tip] {
  z-index: 10;
  padding: 4px 10px;
  color: white;
}
[data-fp-tip-bg] {
  background: #222;
  border-radius: 8px;
}
```

## Accessibility

Screen readers get the full text, links included, from a visually hidden copy.
Visible text stays selectable, copying gives the hidden text, and the tooltip
opens on focus and closes on Escape. Drawn marks survive forced-colors mode,
and transitions respect reduced motion.

## Limits

- Left-to-right text and inline elements only.
- A line whose leftover room exceeds `maxGap` isn't flush.
- In React, a suffix can only be a string.
- Find in page can't find a word an ellipsis cuts in two, and with
  `find: 'keep'` moving past a kept match takes a second Enter.

More in [How it works](docs/how-it-works.md). To work on the library, see
[CONTRIBUTING.md](CONTRIBUTING.md).
