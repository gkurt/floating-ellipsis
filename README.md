# floating-points

Smart text truncation for the DOM.

- **One line or many.** Clamp to any number of lines.
- **Ellipsis anywhere.** `'start'`, `'middle'`, `'end'` or any position from 0 to 1.
- **Balanced spacing.** The visible (ink) gap on both sides of the ellipsis is
  equal. By default it matches the gap between the ellipsis' own dots.
- **Flush ends.** The truncated line ends exactly at the edge of the box, so
  resizing flows continuously instead of stepping a glyph at a time.
- **Hooks.** Whether the text is truncated, what was left out, the line boxes
  and the ellipsis' exact ink box: enough to build tooltips that line up letter
  for letter, or that only respond to the ellipsis.
- **Change diffs.** Glyphs shown and hidden on every resize, with their
  positions, plus an optional transitions add-on (fade, blur, merge into the
  ellipsis).

```js
import { elide } from 'floating-points';

const t = elide(document.querySelector('.filename'), { position: 'middle' });

t.truncated;        // true
t.state.omitted;    // the text the ellipsis stands for
t.ellipsisInk();    // DOMRect around the ellipsis' ink
t.destroy();        // restore the original content
```

## Develop

```bash
npm install
npm run dev     # demo at http://localhost:4181
npm test        # unit tests (pure logic)
npm run build   # dist/ with type declarations
```

The demo is in `demo/`. In it, `window.hero` and `window.pathInstances` are
live instances you can try from the console.

## Options

| Option | Default | |
|---|---|---|
| `text` | element text | Text to show. Defaults to the element's text, with whitespace collapsed. |
| `lines` | `1` | Maximum number of lines. |
| `position` | `'end'` | `'start'`, `'middle'`, `'end'` or a number from 0 to 1. The kept text is split head:tail in that ratio. |
| `ellipsis` | `'…'` | Any string. |
| `gap` | `'dots'` | Ink gap on both sides of the ellipsis. `'dots'`: the spacing between the ellipsis' own marks. `'natural'`: the average of the font's natural gaps. `'none'`: untouched. Or a number in px, or a string like `'0.1em'` / `'2px'`. |
| `justify` | `'ellipsis'` | Where the leftover space goes so the line ends flush. `'ellipsis'`: into both ellipsis gaps, equally. `'spread'`: letter-spacing across the line (single-line only). `false`: leave it at the end. |
| `trim` | `true` | Drop whitespace next to the ellipsis. |
| `snap` | `null` | *Experimental.* Move the cut to nicer boundaries. `separators('/\\')` cuts paths at segments, `separators(' ')` at words. |
| `observe` | `true` | Re-truncate on resize (ResizeObserver) and when web fonts load. |
| `glyphs` | `false` | Wrap each grapheme in its own element, for per-glyph styling and transitions. Adds DOM; meant for short text. |
| `onChange` | — | Same as `instance.onChange(fn)`. |

`instance.update(options)` changes any option, including `text`.

## Instance API

- `state`: `{ text, length, truncated, start, end, head, tail, omitted, lines, gap }`.
  Visible text is graphemes `[0, start)` + ellipsis + `[end, length)`.
  `gap` holds the target, the natural gaps, the final gaps (`left`/`right`)
  and the justification `slack`.
- `truncated`, `graphemes`
- `ellipsisElement`: stable for the life of the instance, so listeners can stay attached.
- `ellipsisRect()`: the ellipsis box, or `null`.
- `ellipsisInk()`: a tight box around the ellipsis' ink, or `null`.
- `lineRects()`: one box per rendered line.
- `glyph(i)`: the element for grapheme `i` (glyph mode).
- `onChange(fn)`: called when the visible text changes. Returns an unsubscribe function.
  The event has `shown` / `hidden` grapheme indices, `hiddenRects` (where hidden
  glyphs were, in glyph mode), and `ellipsis.from` / `ellipsis.to`.
- `refresh()`, `update(options)`, `destroy()`

The element also gets a `data-truncated` attribute, for CSS.

## Transitions

```js
import { elide } from 'floating-points';
import { transitions } from 'floating-points/transitions';

const t = elide(el, { position: 0.5, glyphs: true });
const stop = transitions(t, { effect: 'merge' }); // 'fade' | 'blur' | 'merge'
```

Glyphs that appear fly out of the ellipsis, and glyphs that disappear fly into it.
Ghost glyphs are drawn in an overlay next to the text, never inside it, so
they don't disturb measurement. They follow their glyph while the text reflows.
Respects `prefers-reduced-motion`.

## How it works

1. **Fit.** The text is rendered into the element and measured with
   `getClientRects()`, so every CSS property that affects layout is respected.
   A search finds the most graphemes that fit in `lines` lines. On resize it
   starts from the previous answer, which usually takes 2–3 layout passes.
2. **Balance.** Glyphs are measured on a canvas at 128px and scaled down,
   because browsers round glyph boxes to whole pixels. The gaps between ink
   edges are computed with kerning ignored, and margins on the ellipsis make
   both gaps equal the target. For `'dots'`, the ellipsis is drawn on a canvas
   and scanned for the empty columns between its marks.
3. **Justify.** Whatever space is left on the ellipsis' line goes into the gaps
   (or the letter-spacing), backing off by a fraction of a pixel if layout
   rounding would make the line wrap.

## Limits

- Plain text only. Left-to-right text only.
- The element's width must not depend on its content. Use a block, or a flex
  item with `min-width: 0`.
- With several lines, justification only applies when the ellipsis is on the
  last line. On earlier lines the leftover space comes from word wrapping and
  would leave a hole.
- `snap` is a first pass. Snapping can drop a whole segment, which then shows
  as wide ellipsis gaps when `justify: 'ellipsis'` is on.
