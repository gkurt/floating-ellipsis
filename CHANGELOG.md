## floating-ellipsis@1.0.0

### Drawn marks and gaps sized right in WebKit on Linux and Windows

Where the canvas doesn't report glyph ink, it is read off a drawing, so bullets and rings are no longer twice their size there.

### Lines end flush where cuts judged without rendering are a little off

A judged cut is checked when the font's judgements have been off by more than a tenth of a pixel.

### First stable release

Fluid, balanced truncation for one line or many: the ellipsis anywhere, kept and highlighted parts, word and path snapping, a capped justification gap (`maxGap`), a headless tooltip, transitions, `elideText` without the DOM, a CSS fallback for before scripts run, and bindings for custom elements, React, Vue and Svelte.

### Geometry, glyph mode, suffixes and `onChange` move to their own entries

The core is about 2 kB smaller gzipped. Pages that use them import them: `floating-ellipsis/geometry` (`ellipsisRect(t, i)`, `graphemeAt(t, …)` and the other box methods, as functions; `marks(i)` is now `markInks(t, i)`), `floating-ellipsis/changes` (`onChange(t, fn)`, replacing the method and option; bindings keep `onChange`), `floating-ellipsis/glyphs` (`glyphs: glyphs` in place of `glyphs: true`, and `glyph(t, i)`, `glyphInk(t, i)`) and `floating-ellipsis/suffix` (`suffix: suffix(content, { show })`, replacing `suffix` and `showSuffix`).

### Find in page finds the new text after `update({ text })` hides the same range as before

### Several lines fit and end flush with `text-wrap: balance` or `pretty`

Truncated text breaks its lines one after another (the element's `text-wrap-style` is held at `auto` while truncated), so the ellipsis line reaches the edge and the text no longer runs a line over. Text that fits still wraps as the page says.

### Find in page finds what an ellipsis hides

By default the word a match starts in stays in sight, marked `data-fp-match`; `find: 'expand'` expands the text instead, and `find: false` turns it off. A match in text that shows no longer counts twice.

### Smaller bundles

Internal members are now `#private`, so minifiers shorten their names: the core entry and the framework bindings are about 0.45 kB smaller gzipped, and the tooltip about 0.17 kB.

### Crowded tables and several lines truncate with fewer layouts

Resizing a table of one-line cells takes one layout per frame besides the browser's own, text on several lines about half the layouts it did, and highlighted text is judged without rendering when the highlights only colour it. `find: false` now keeps what an ellipsis hides out of the document, which makes every layout a little cheaper.

### `suffix`, `showSuffix`, `expand()` and `collapse()`

A "Read more" button, badge or time follows the text on its last line and is never cut, fitting again when it changes width, and `expand()` shows all of the text in place.

### Truncating is faster, with fewer layouts

Single-line cuts are judged from glyph widths and kerning without rendering them, and less work is redone on every pass: refreshing a crowded table takes about half the time and layouts, and resizing one or setting new text about a fifth less. Long text and several lines gain the most.

### Links and other inline elements survive the cut

The text is read with its inline elements, and every part of the line that shows sits inside copies of them; `text` also takes a node.

### `words()` keeps a cut at the end of the text there

A cut at the end (or start) of text ending in punctuation no longer moves inward and leaves the last word showing.
