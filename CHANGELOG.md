## floating-ellipsis@1.0.1

### Tooltips are as wide as a readable line, not half the window

The tooltip's `maxWidth` is now in ems of the text (default `40`) instead of a fraction of the window, so a tip can use a narrow window's whole width. Tips also show sooner and grow faster: `delay` defaults to `300` and `duration` to `240`.

## floating-ellipsis@1.0.0

### First stable release

Fluid, balanced truncation for the DOM, for one line or many.

- **Anywhere, any length.** Clamp to any number of lines, or as many as fit the element's height (`lines: 'fit'`), with the ellipsis at the start, middle, end, any position, or several at once: a share of the text, or a place along the line (`'50%'`, `'120px'`), so a column's ellipses line up.
- **Balanced and flush.** Even ink gaps on both sides of the ellipsis, and lines that end exactly at the edge (`justify`: `'dots'`, `'ellipsis'` or `'spread'`), with justified gaps capped by `maxGap` and leftover room optionally filled with more marks (`repeat`). Text a little too long can set tighter instead of being truncated (`tighten`), and a truncated line tighter to show more (`tightenCuts`).
- **Marks.** Any string, or drawn dots, bullets, rings and squares sized from the font. Dots in brackets (`'[…]'`) mark words left out of a quotation, set like a word. `ellipsis: 'auto'` sets Chinese and Japanese text's ellipsis in the middle of the line, on as many of its cells as it takes, so the characters after it stay in their columns.
- **Keep what matters.** Words, patterns or ranges that stay visible (`keep`), optionally highlighted with a class, with words of context around them like a search result's snippet (`context`), or on one side only (`{ before, after }`).
- **Words, paths and numbers.** Truncation that snaps to whole words (`words()`) or path segments (`separators()`), and never split a number, a date or any other part marked `whole`.
- **Short forms first.** Parts show shorter before anything is truncated, a step at a time, as few as fit (`shorten`, or `data-elide-short` in markup): "Wednesday" as "Wed", "Christopher Robin" as "C. Robin". `dateForms` (`floating-ellipsis/dates`) returns a date's forms from long to short, in its locale's format.
- **Rich text.** Links and other inline elements survive truncation; images, icons and `data-elide-unit` elements show whole or not at all.
- **Suffixes.** A "Read more" button, badge or time follows the text on its last line and is never truncated (`floating-ellipsis/suffix`), with `expand()` and `collapse()`.
- **Lists.** Items hidden whole, with a label for the rest, joined as the list joins its last item: "Ada, Grace and 2 others" (`floating-ellipsis/list`).
- **Inputs.** `elideInput` (`floating-ellipsis/input`) shows an input's or a textarea's value truncated until it's edited, a textarea's on as many lines as its height holds; a press puts the caret on the glyph pressed.
- **Sized by content.** `autoSize()` (`floating-ellipsis/autosize`) lets an inline-block, float or flex item take its full text's width, so it grows back.
- **Native behaviour.** Find in page finds hidden text, a selection highlights ellipses and short forms as it does text, copying gives the full text, and screen readers read it all.
- **Fast in bulk.** Passes run in lockstep, so thousands of instances share a few layouts, and single-line truncation is judged from glyph widths without rendering.
- **Add-ons**, in their own entries so pages that don't use them don't ship them: a headless tooltip (`floating-ellipsis/tooltip`), glyph transitions (`floating-ellipsis/transitions`), geometry, glyph mode, `onChange`, and `elideText` (`floating-ellipsis/text`) for the same truncation without the DOM.
- **Before scripts run.** `floating-ellipsis/fallback.css` truncates with CSS until an instance takes over.
- **Frameworks.** `<elide-text>`, React (`useElide`, `<Elided>`, Server Components ready), Vue (`vElide`) and Svelte (the `elide` action).
