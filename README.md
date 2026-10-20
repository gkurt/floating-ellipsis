# floating-ellipsis

Fluid, balanced ellipsis. Smart text truncation for the DOM. **[Live demo →](https://gkurt.com/floating-ellipsis/)**

- **Anywhere, any length.** Clamp to any number of lines (or as many as fit the height), with the ellipsis at
  the start, middle, end, any position, or several at once.
- **Balanced and flush.** Even spacing on both sides of the ellipsis, and lines
  that end exactly at the edge, so resizing flows instead of stepping. Text a
  hair too long can set tighter instead of being truncated.
- **Keep what matters.** Pin words, patterns or ranges so they stay visible,
  highlight them, and show words of context around them, like a search
  result's snippet.
- **Words, paths and numbers.** Truncation can snap to whole words or path
  segments, and never split a number, a date or anything else you mark whole.
- **Short forms first.** Parts can show shorter before anything is truncated:
  "Wednesday" as "Wed", a date down to "10/14/26".
- **Rich text.** Links and inline markup survive truncation; a suffix ("Read
  more", a badge) follows the text and is never truncated.
- **Native behaviour.** Find in page finds hidden text, copying gives the full
  text, screen readers read it all.
- **Lists.** Whole items, and a label for the rest: "Ada, Grace and 2 others".
- **Add-ons.** Headless tooltips, glyph transitions, inputs truncated until
  you edit them, a DOM-free `elideText`, a CSS fallback, and bindings for
  custom elements, React, Vue and Svelte.
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

By default the element's width comes from its container, not its text: use a
block, or a flex or grid item with `min-width: 0`. For one sized by its text
(a chip, an inline-block, a float), add `autoSize()`: see [Sized by content](#sized-by-content).

## Options

| Option        | Default         |                                                                                                                                                                                        |
| ------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`        | element content | A string, or a node whose text and inline elements are shown.                                                                                                                          |
| `lines`       | `1`             | Maximum number of lines, or `'fit'`: as many as fit the element's height (capped by `height`, `max-height`, or a flex or grid track).                                                  |
| `position`    | `'end'`         | A share of the text: `'start'`, `'middle'`, `'end'` or 0 to 1. Or a place along the line: `'50%'`, `'120px'`, `'8em'`. An array for several.                                           |
| `keep`        | `null`          | Parts that stay visible: a string, a RegExp, `{ start, end }`, or an array. The object forms take `class` to highlight them, `context` for words around them (or `{ before, after }`). |
| `ellipsis`    | `'…'`           | A string (each character is a mark; `'[…]'` is one), `'auto'`, or drawn marks: `{ shape: 'dot' \| 'bullet' \| 'ring' \| 'square', count?, size?, spacing?, like?, align?, cells? }`.   |
| `gap`         | `'dots'`        | Ink gap beside the ellipsis: `'dots'` (its own dot spacing), `'natural'`, `'none'`, px, or a CSS length.                                                                               |
| `justify`     | `'dots'`        | Where leftover room goes so lines end flush: `'dots'` (all gaps equal), `'ellipsis'` (the two outer gaps), `'spread'` (letter-spacing), or `false`.                                    |
| `repeat`      | `false`         | Fill leftover room with more marks: this share (0 to 1) of as many as fit at their own spacing. `1` adds one wherever it fits; `false` adds none.                                      |
| `maxGap`      | `'0.75em'`      | The widest a justified gap gets; room past it stays at the line's end. `null`: no limit.                                                                                               |
| `trim`        | `true`          | Drop whitespace next to an ellipsis.                                                                                                                                                   |
| `snap`        | `null`          | `words()` or `separators(chars)`. See [Snapping](#snapping).                                                                                                                           |
| `whole`       | `null`          | Parts shown whole or not at all, never split: a string, a RegExp, `{ start, end }`, or an array. See [Wholes](#wholes).                                                                |
| `tighten`     | `0`             | Letters may set this much closer (px or `'0.05em'`, word spaces twice that) so text a little too long shows whole. See [Tightening](#tightening).                                      |
| `tightenCuts` | `false`         | On one line, set truncated text tighter too, by up to `tighten`, to show more of it.                                                                                                   |
| `shorten`     | `null`          | Parts that show shorter before anything is truncated: `{ match, to }` or `{ start, end, to }`, `to` a form or several, or an array. See [Short forms](#short-forms).                   |
| `observe`     | `true`          | Re-truncate on resize and when web fonts load.                                                                                                                                         |
| `glyphs`      | `null`          | `glyphs` from `floating-ellipsis/glyphs`: each grapheme in its own element, for per-glyph styling and transitions. Meant for short text.                                               |
| `title`       | `false`         | Put the full text in `title` while truncated or shortened.                                                                                                                             |
| `copy`        | `'full'`        | What copying across an ellipsis gives: `'full'` (the hidden text) or `'visible'`.                                                                                                      |
| `suffix`      | `null`          | `suffix(content)` from `floating-ellipsis/suffix`. See [Suffixes](#suffixes).                                                                                                          |
| `find`        | `'keep'`        | Find in page on hidden text: `'keep'` reveals the matched word, `'expand'` expands the text, `false` leaves it out (lighter in crowded tables).                                        |
| `autoSize`    | `null`          | `autoSize()` from `floating-ellipsis/autosize`, for an element whose width comes from its content. See [Sized by content](#sized-by-content).                                          |

`instance.update(options)` changes any option, including `text`.

### Places along the line

```js
elide(cell, { position: '50%' }); // the ellipsis in the middle of the cell
elide(cell, { position: '120px' }); // or 120px from the start of the line
```

A number puts the ellipsis that share of the way through the text, so where
it lands depends on the text. A place puts it along the line instead: a share
of the content box's width (`'50%'`) or a length from its start (`'120px'`,
`'8em'`), for the ellipsis' middle, as far in as it needs. The text before it
shows as much as fits before the place, and the text after it the rest, so
the cells of a column put theirs within about a glyph of each other. It's
still truncated, spaced and justified as usual, so the text around it and its
gaps move it that much. In an array with a place, a number is a share of the
line too; on more than one line, `'50%'` is half the text, and a length the
middle. `elideText` takes places too, along its `width`.

### Drawn marks

```js
elide(el, { ellipsis: { shape: 'bullet' } }); // • • •, sized like the font's •
elide(el, { ellipsis: { shape: 'square', size: '0.12em', spacing: 3 } });
elide(el, { ellipsis: { shape: 'dot', like: '…', count: 5 } }); // the font's … as five dots
elide(el, { ellipsis: '' }); // no marks, just a balanced gap
```

Marks are sized from the font: dots and squares from its `.`, bullets and rings
from its `•`.

### Quotations, Chinese and Japanese

```js
elide(quote, { position: 'middle', ellipsis: '[…]', snap: words() }); // "…weaves […] flowers and leaves."
elide(el, { ellipsis: 'auto' }); // 我们在桥上⋯⋯台阶。 for Chinese and Japanese, '…' for other text
elide(el, { ellipsis: { shape: 'dot', count: 6, cells: 2, align: 'middle' } }); // what 'auto' draws on several lines
```

Dots in brackets (`'[…]'`, `'(…)'`, `'<…>'`) are one mark: the brackets hug
the dots, and the gaps either side start from a word space. `'auto'` draws
Chinese and Japanese text's ellipsis in the middle of the line, whatever font
the dots would come from: three dots in one character's cell on one line, six
over two on more. `align: 'middle'` sets marks in the middle of an
ideograph's box; `cells` makes the ellipsis exactly as wide as that many
ideographs, so the characters after it stay in their columns, even on a
justified line. The text's script is checked first (more ideographs and kana than
other letters), then the element's `lang`.

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

With `context`, words around every match show before any other text, a word
at a time after each match and then before it, so each gets a word before
any gets two: a search result's snippet. `Infinity` shows as many as fit; a
number stops there, and the rest of the room goes where `position` puts the ellipsis.
The word that doesn't fit shows as much of itself as fits, as truncation does
elsewhere (`snap: words()` shows only whole words), and a `whole` waits until
the other side's words show, then shows entire.

```js
elide(el, { keep: { match: /lantern/gi, class: 'hit', context: Infinity } }); // …by dusk the lantern by the gate…
```

`{ before, after }` counts each side on its own, and a side left out shows
none: the command after a shared prefix, with the prefix truncated.

```js
elide(el, { keep: ['cd "', '" && ', { match: /(?<=" && )\S+/, context: { after: Infinity } }] }); // cd "…" && npm run build -- --wat…
```

### Snapping

```js
import { separators, words } from 'floating-ellipsis';
elide(el, { snap: words() }); // The quick brown…lazy dog
elide(el, { snap: separators('/\\') }); // /Users/ada/Projects/anal…/notes/x.md
elide(el, { snap: separators('/\\', { fragment: false }) }); // /Users/ada/…/difference-engine/notes/x.md
```

`words()` truncates between words in any language `Intl.Segmenter` supports.
`separators(chars)` takes a string of characters or a RegExp. By default one
side of a truncated path keeps a piece of its segment (`fragment: 'head'`, or
`'tail'`), so it shows about as much as plain truncation; with `false` only
whole segments go, as with `words()`.

### Wholes

```js
elide(el, { position: 'middle', whole: /[$€£]?\d[\d,.:/-]*\d%?/g }); // Invoice…ref 88412093, never Invoice 20…
```

An ellipsis that would split a match of `whole` moves off it, hiding as much just
beside it, or hides all of it at an end of the text. It's the same rule
`words()` follows (where truncation may start and end), so the two combine:
`{ snap: words(), whole: … }` keeps to both.

### Tightening

```js
elide(el, { tighten: '0.05em' });
```

Text that runs over by a little shows whole, set tighter rather than truncated,
word spaces by twice what letters are, and only as much as it takes, so a
line ends at the edge. Past `tighten`, it's truncated, and set as
usual. `state.tightened` is how much (px per letter).

```js
elide(el, { tighten: '0.05em', tightenCuts: true });
```

With `tightenCuts`, truncated text on one line is set tighter too, by up to
`tighten`, to show as many more letters as that makes room for. The
ellipsis and the letters beside it keep their spacing.

### Short forms

```js
elide(el, {
  shorten: [
    { match: 'Christopher Robin', to: ['C. Robin', 'C. R.'] },
    { match: 'Wednesday', to: 'Wed' },
    { match: ' 2026', to: '' }, // the year goes first
  ],
});
```

Parts show shorter, a step at a time, before any text is truncated: only as many
steps as it takes to fit. Every part takes its first form before any takes
its second, and the last entry goes first, so list them from most to least
important, as with `keep`. Text set tighter (`tighten`) counts as fitting.
Past the last step, the text is truncated with every part at its shortest. A part
showing short is never split, only hidden whole. Copying, find in page, the
`title` and screen readers get the long form, and `expand()` shows it; a
search for a long form shows it until a press elsewhere, as `find` does for
hidden text.

`match` finds parts as `keep` does: a string's first match, every match of
a global RegExp; `{ start, end }` takes string offsets. In markup,
`data-elide-short` gives an element's text a form:

```html
<p>Due <span data-elide-short="Wed">Wednesday</span>, 14 <span data-elide-short="Oct">October</span></p>
```

`floating-ellipsis/dates` writes a date from long to short, as the locale
does, as plain data that a server can make too:

```js
import { dateForms } from 'floating-ellipsis/dates';

elide(el, dateForms(event.start, { locale: 'en-US' })); // Wednesday, October 14, 2026 … Oct 14, 2026 … 10/14/26
const due = dateForms(deadline);
elide(el, { text: `Due ${due.text}`, shorten: due.shorten });
```

It takes `locale`, `timeZone`, `year` and `weekday` (both shown by default)
and `time` (hours and minutes). The element gets `data-shortened`, and
`state.short` lists the parts showing short, each `{ start, end, text, form }`.

### Markup

```js
elide(document.querySelector('.post'), { lines: 3 }); // links, code, emphasis kept
```

Inline elements are copied around whatever part of them shows. The copies have
no `id` or listeners, so listen on the element or above it. Keyboard focus goes
to the full text's links; their copies in the line get `data-fp-focus` for a
focus ring.

Images and icons (`img`, `svg`, `picture`, `canvas`, `video`) show whole or
not at all, as one grapheme that stands for their `alt` or `aria-label` text
(U+FFFC without one) in `state`, the title and copied text. `data-elide-unit`
does the same for any element, such as a mention or a badge. Their copies in
the line are marked `data-fp-unit`.

```html
<div class="file"><svg aria-label="PDF">…</svg> Q3 report, final draft.pdf</div>
<p>Assigned to <span data-elide-unit class="mention">@ada</span> and the team</p>
```

### Suffixes

```js
import { suffix } from 'floating-ellipsis/suffix';

const more = document.createElement('button');
more.textContent = 'Read more';
const post = elide(el, { lines: 3, suffix: suffix(more, { show: 'truncated' }) });
more.onclick = () => (post.expanded ? post.collapse() : post.expand());
```

The content is a string or a node, which follows the text on its last line and
is never truncated. A node is moved into place, keeping its listeners, and goes back
on `destroy()`. `show` is `'always'` (default) or `'truncated'`. `expand()`
shows all of the text until `collapse()`. To animate the height as it opens and
closes, see [Animating "Read more"](docs/how-it-works.md#animating-read-more).

### Lists

```js
import { list, split } from 'floating-ellipsis/list';

elide(el, { ...list(['Ada', 'Grace', 'Linus', 'Ken'], { label: (n) => `${n} others` }) }); // Ada, Grace and 2 others
elide(el, { ...list(split(', '), { label: (n) => `+${n}`, joiner: ' ' }) }); // the element's own items: @ada, @grace +2
```

Items show whole or not at all, from the start, and a label for the hidden
ones follows the last that shows. When not even the first fits, it is truncated and
the label starts with an ellipsis (`Ada Lovel… and 3 others`). Items are an
array, joined into the text by `Intl.ListFormat`, or a function that finds
them in the text, in order; `split(separator)` takes a string or a RegExp.
`data-elide-unit` elements (mentions, chips) count as items. Spread it before
your own options: it sets `snap`, `suffix`, `position`, `ellipsis`, `gap`,
`justify`, `repeat` and `find`.

| Option     | Default                  |                                                                                     |
| ---------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `label`    | `` (n) => `${n} more` `` | What stands for the hidden items, given how many are hidden and how many there are. |
| `joiner`   | the list's own           | What goes between the last item showing and the label.                              |
| `format`   | `new Intl.ListFormat()`  | How an array is joined into the text, and how the label joins it.                   |
| `ellipsis` | `'…'`                    | What ends the first item when it is truncated.                                      |

The label is `[data-fp-list]`, for styling. Screen readers read every item,
and find in page and copying leave the label out.

### Sized by content

```js
import { autoSize } from 'floating-ellipsis/autosize';

// .chip { display: inline-block; max-width: 100%; }
elide(chip, { position: 'middle', autoSize: autoSize() });
```

An inline-block, a float, an absolutely positioned element, or a flex or grid
item sized by its content takes its width from the text that shows, so once
truncated it never grows back. With `autoSize()`, an invisible copy of the full text
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

- `state`: `{ text, length, truncated, expanded, hidden, kept, lines, gaps, slack, tightened, shortened, short }`.
  `hidden` and `kept` are `{ start, end, text }` lists in grapheme indices;
  `short` adds the `form` showing.
- `truncated`, `expanded`, `graphemes`, `options`, `markStyle`, `classOf(i)`,
  `unitOf(i)` (the image or element grapheme `i` stands for, or null).
- `ellipsisElement` (the first, stable for the instance's life), `ellipses`.
- `onRender(fn)`: after every layout pass. Returns an unsubscribe function.
- `expand()`, `collapse()`, `refresh()`, `update(options)`, `destroy()`.

The element gets `data-truncated`, `data-shortened` while a part shows a
short form, and `data-fp-expanded` while expanded.
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
  `shortRect(t, i)` and `shortElement(t, i)`: a short form, part `i` of
  `state.short`.
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

CSS can only truncate at the end, and `data-elide-fallback="fit"` only clips. React's `<Elided>` renders this markup itself, so
server-rendered pages show truncated text before hydration.

## Text without the DOM

```js
import { elideText } from 'floating-ellipsis/text';

elideText(path, { width: 180, font: '13px Inter', position: 'middle', keep: /\.[^.]+$/ }).text;
```

The same truncation as a string, on one line, for canvas, SVG, workers or the server.
It takes `width`, `font` or your own `measure(text)`, `letterSpacing`, and
`position`, `keep`, `ellipsis` (a string; `'auto'` is the midline `⋯` for
Chinese and Japanese), `trim`, `snap`, `whole`, `shorten`,
`tighten` (in `measure`'s unit) and `tightenCuts` as in `elide`. It returns
`{ text, truncated, hidden, kept, short, width, tightened }`.

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
for `title`, `keep-class` to highlight `keep` and `keep-context` for words
around it, `whole="/\d+/g"`, `snap="words|paths"`, `auto-size`), or all of
them through its `options` property. A child with `slot="suffix"` is its suffix, and
children with `data-elide-short` show short forms. It exposes
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

`<Elided>` hands its instance to `instanceRef` once mounted, for the add-ons;
a callback may return its cleanup. Keep it stable (module-level or
`useCallback`), or it detaches and attaches on every render:

```jsx
// Made on first use: ref callbacks only run in the browser.
let tips;
const attach = (t) => t && (tips ??= tooltip({ breaks: '/' })).attach(t, t.element.closest('tr') ?? t.element);

<Elided text={path} position="middle" instanceRef={attach} />;
```

`suffix` takes a string or any React node, with `showSuffix` (`'always'` or
`'truncated'`). A node is rendered through a portal, so its handlers work, and
shows once the page has hydrated:

```jsx
<Elided text={post} lines={3} suffix={<button onClick={() => setOpen(true)}>Read more</button>} showSuffix="truncated" />
```

React and React DOM (18+) are optional peer dependencies. In virtual lists, either recycle
instances with `update({ text })` or mount one per row; both cost the same.

### Next.js and shadcn/ui

`floating-ellipsis/react` is a Client Component (`'use client'`), so Server
Components render `<Elided>` as is. With `fallback.css` imported in the layout,
static and server-rendered pages show the text truncated at the end until they
hydrate. Props from a Server Component must serialize: `keep` as a string, not
a RegExp; set `snap`, `onChange`, `glyphs` and `instanceRef` in a Client
Component. A `suffix` can come from the server as a string or an element (a
Client Component's, for one with handlers). `shorten` with string matches
serializes, so `<Elided {...dateForms(date)} />` works in a Server Component.

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
open a tooltip only while the text is truncated, check the trigger's `data-truncated`
in `onOpenChange`. [`examples/next`](examples/next) is a file browser built
from shadcn components (buttons, Radix and Base UI tooltips, a table, cards)
with floating-ellipsis's own tooltips grown over the rows, static and
server-rendered.

## Transitions

```js
import { glyphs } from 'floating-ellipsis/glyphs';
import { transitions } from 'floating-ellipsis/transitions';

const t = elide(el, { position: 0.5, glyphs });
const stop = transitions(t, { effect: 'merge' });
```

| Option     | Default   |                                                                                     |
| ---------- | --------- | ----------------------------------------------------------------------------------- |
| `effect`   | `'merge'` | `'merge'` (glyphs shrink and fade into the dots), `'fade'`, `'blur'` or `'none'`.   |
| `duration` | `460`     | Milliseconds. Leaving glyphs take less when squeezed or dragged fast.               |
| `glide`    | `true`    | The ellipsis' spacing glides when the truncation changes. Works without glyph mode. |

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
ellipsis?)` and `hide()` open and close the tooltip, `update(options)` changes
its options and `destroy()` removes it.

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

## Inputs

```js
import { elideInput } from 'floating-ellipsis/input';

const elided = elideInput(document.querySelector('input[name=path]'), { position: 'middle', keep: /[^/]+$/ });
elideInput(document.querySelector('textarea'), { position: 'end' });
```

An input shows its value truncated while it isn't being edited, and its
placeholder truncated while it's empty. Press it anywhere, even on an ellipsis,
and the whole value appears with the glyph you pressed still under the
pointer and the caret beside it; dragging selects as usual. The value, the
input and what a form submits stay as they are: a copy of the truncated text
lies over the input's own, which is hidden while the copy shows. It follows the
value as you type, as a framework sets it, and as a form resets it.

A textarea's value wraps as the textarea wraps it, on as many lines as its
height holds, and a press keeps the line pressed under the pointer. While
truncated, it doesn't scroll.

It takes `elide`'s options, but those about suffixes and find in page, and
`lines` only for a textarea (`'fit'` by default). It returns
`{ instance, update(options), refresh(), destroy() }`. A password input never
shows its value truncated, including one whose type a "show" button flips.

## Accessibility

Screen readers get the full text, links included, from a visually hidden copy.
Visible text stays selectable, a selection highlights ellipses and short forms
too, copying gives the hidden text, and the tooltip
opens on focus and closes on Escape. Drawn marks survive forced-colors mode,
and transitions respect reduced motion.

## Limits

- Left-to-right text and inline elements only.
- A line whose leftover room exceeds `maxGap` isn't flush.
- With `lines: 'fit'`, a `max-height` in percent that grows past the lines
  showing needs `refresh()`.
- Find in page can't find a word an ellipsis splits in two, and with
  `find: 'keep'` moving past a kept match takes a second Enter.
- `elideInput` lines the pressed glyph up only in inputs set from the left;
  in a textarea, the line pressed stays under the pointer, but its glyphs
  can move along it.

More in [How it works](docs/how-it-works.md). To work on the library, see
[CONTRIBUTING.md](CONTRIBUTING.md).
