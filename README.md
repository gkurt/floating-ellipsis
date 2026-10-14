# floating-ellipsis

Fluid, balanced ellipsis. Smart text truncation for the DOM.

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
- **Copy-friendly.** Selecting across an ellipsis and copying gives the hidden
  text. Screen readers get the full text.
- **Hooks.** Whether the text is truncated, what each ellipsis hides, the line
  boxes, and the exact ink box of every dot: enough to build tooltips that line
  up letter for letter, or that only respond to the ellipsis.
- **Change diffs and transitions.** Glyphs shown and hidden on every resize,
  with their positions, plus an optional add-on that morphs glyphs into the
  nearest dot.

```js
import { elide } from 'floating-ellipsis';

const t = elide(document.querySelector('.filename'), {
  position: 'middle',
  keep: /\.[^.]+$/, // always show the extension
});

t.truncated;          // true
t.state.hidden;       // [{ start, end, text }], one per ellipsis
t.ellipsisInk(0);     // DOMRect around the first ellipsis' ink
t.destroy();          // restore the original content
```

## Develop

```bash
npm install
npm run dev     # demo at http://localhost:4181
npm test        # unit tests (pure logic)
npm run build   # dist/ with type declarations
```

The demo is in `demo/`. In it, `window.hero`, `window.keepExamples` and
`window.pathInstances` are live instances you can try from the console. The
hero's "Keep visible" field takes comma-separated words or `/regex/flags`.

## Options

| Option | Default | |
|---|---|---|
| `text` | element text | Text to show. Defaults to the element's text, with whitespace collapsed. |
| `lines` | `1` | Maximum number of lines. |
| `position` | `'end'` | `'start'`, `'middle'`, `'end'` or a number from 0 to 1. An array such as `[0.33, 0.67]` places several ellipses. |
| `keep` | `null` | Parts that always stay visible: a string (first match), a RegExp (every match if global), `{ start, end }` string offsets, or an array of these. When they can't all fit, the last ones give way first. |
| `ellipsis` | `'…'` | A string, where each character is a separate mark (`'...'`, `'·····'`). Or drawn marks: `{ shape: 'dot' \| 'bullet' \| 'ring' \| 'square', count?, size?, spacing?, like? }`. |
| `gap` | `'dots'` | Ink gap on both sides of the ellipsis. `'dots'`: the spacing between the ellipsis' own marks. `'natural'`: the average of the font's natural gaps. `'none'`: untouched. Or a number in px, or a string like `'0.1em'` / `'2px'`. |
| `justify` | `'dots'` | Where the leftover space on each line holding an ellipsis goes, so the line ends flush. `'dots'`: every gap (text, marks, text) becomes equal; a single `…` is redrawn as separate dots shaped like its own. `'ellipsis'`: into the two gaps around the ellipsis, equally, keeping the dots' own spacing. `'spread'`: letter-spacing across the line (single-line only; otherwise like `'ellipsis'`). `false`: leave it at the end. |
| `trim` | `true` | Drop whitespace next to an ellipsis. |
| `snap` | `null` | *Experimental.* Move cuts to nicer boundaries. `separators('/\\')` cuts paths at segments, `separators(' ')` at words. |
| `observe` | `true` | Re-truncate on resize (ResizeObserver) and when web fonts load. |
| `glyphs` | `false` | Wrap each grapheme in its own element, for per-glyph styling and transitions. Kept glyphs get `data-fp-kept`. Adds DOM; meant for short text. |
| `title` | `false` | Put the full text in the element's `title` while it is truncated. |
| `copy` | `'full'` | What a copied selection holds where it crosses an ellipsis: `'full'` (the hidden text) or `'visible'` (the ellipsis). |
| `onChange` | — | Same as `instance.onChange(fn)`. |

`instance.update(options)` changes any option, including `text`.

### Drawn marks

```js
elide(el, { ellipsis: { shape: 'bullet' } });                 // • • •, sized like the font's •
elide(el, { ellipsis: { shape: 'ring', count: 4 } });
elide(el, { ellipsis: { shape: 'square', size: '0.12em', spacing: 3 } });
elide(el, { ellipsis: { shape: 'dot', like: '…' } });         // the font's … as separate dots
elide(el, { ellipsis: { shape: 'dot', like: '…', count: 5 } }); // five of them
elide(el, { ellipsis: '' });                                   // no marks, just a balanced gap
```

`count` can be anything from 0 up. With no marks (`count: 0` or `''`), the cut
still leaves a gap the size of the font's dot rhythm, balanced and justified
like any other.

Dots and squares take their size and height from the font's `.`; bullets and
rings from its `•`. The spacing defaults to the font's own ellipsis rhythm,
scaled to the mark size.

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

## Transitions

```js
import { elide } from 'floating-ellipsis';
import { transitions } from 'floating-ellipsis/transitions';

const t = elide(el, { position: 0.5, glyphs: true });
const stop = transitions(t, { effect: 'merge' }); // 'fade' | 'blur' | 'merge'
```

| Option | Default | |
|---|---|---|
| `effect` | `'merge'` | `'merge'`, `'fade'`, `'blur'`, or `'none'` (glyphs come and go at once; the dots still glide). |
| `duration` | `460` | Milliseconds for glyph effects, and roughly how long the dots take to settle. |
| `glide` | `true` | When the cut changes, the ellipsis' spacing glides instead of jumping. The dots always sit evenly in the space between their neighbouring glyphs; that space's edges glide on a critically damped spring (velocity carries over, no overshoot). An edge only reaches past a glyph that is still on its way in, so the dots never run into the text. Works without glyph mode too. |
| `pace` | `'leeway'` | How long glyph effects take. `'leeway'`: leaving glyphs take time in proportion to the room their removal frees, and arriving ones are compressed by how many arrive side by side. Every effect is also capped at three times the interval since the previous change, so a fast drag or slider sweep is instant, and anything still in flight finishes at once instead of piling up. `'fixed'`: always `duration`. |
| `marks` | `'together'` | When the spacing widens as glyphs leave: `'together'` with them, or `'after'` they have merged, so the dots only spread into the freed space once it is empty. |

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

## How it works

1. **Fit.** The text is rendered into the element and measured with
   `getClientRects()`, so every CSS property that affects layout is respected.
   A search finds the most graphemes that fit in `lines` lines. On resize it
   starts from the previous answer, which usually takes 2–3 layout passes. The
   full text is only tried when its summed glyph widths could fit.
2. **Islands.** With N ellipses, the kept text forms N + 1 islands: the first
   anchored at the start, the last at the end, and the ones in between centred
   where they sit in the text. Kept graphemes are handed out one at a time in
   proportion to the positions, so every island only grows as space grows. Kept
   parts are added on top, and each gap left over becomes an ellipsis.
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

## Accessibility

- Screen readers get the full text from a visually hidden copy; the truncated
  rendering is `aria-hidden`.
- The visible text stays selectable, and copying across an ellipsis gives the
  hidden text (`copy: 'full'`).
- `title: true` adds a native tooltip with the full text while truncated.
- Drawn marks stay visible in forced-colors (high contrast) mode.
- Transitions respect `prefers-reduced-motion`.

## Limits

- Plain text only. Left-to-right text only.
- The element's width must not depend on its content. Use a block, or a flex
  or grid item with `min-width: 0`.
- With several lines, a line holding an ellipsis is filled to the edge even
  when its leftover space comes from a long word wrapping to the next line, so
  the gaps there can get wide.
- `snap` is a first pass. Snapping can drop a whole segment, which then shows
  as wide ellipsis gaps when `justify` is on.
