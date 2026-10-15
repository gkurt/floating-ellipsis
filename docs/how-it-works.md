# How it works

Implementation details behind the behaviour described in the
[README](../README.md).

## A layout pass

1. **Fit.** The text is rendered into the element and measured with
   `getClientRects()`, so every CSS property that affects layout is respected.
   A search finds the most graphemes that fit in `lines` lines. It starts from
   what the summed glyph widths say fits, shifted by how far off that was last
   time, so it usually only has to confirm it. Each cut it renders says how
   much room it left on the lines, or how much spilled past them, and the
   next aims where the glyph widths say that room ends, one past it first, so
   that a true aim ends on the answer already rendered: two or three layouts
   for several lines, where halving took five or more. On one line, once one
   cut has been measured, any other is judged from glyph widths and kerning
   pairs alone when it clears the edge by a margin, so a resize or new text
   usually needs no layout but the one that checks the answer. The margin
   starts at a twentieth of an em; every check records how far off the
   judgement was for that font, and once there are enough, the margin is three
   times the most it was off (a tenth of a pixel in most engines, a third in
   one), so fewer cuts need rendering to tell. Text with
   highlights or inline elements is judged too when each kind showing sets
   text as the element does: the same font, spacing and case, and no padding,
   border or margin. If the check finds the widths were off (three-letter
   ligatures, `font-kerning: none`), the cut is found again by rendering, and
   that text isn't judged again. The full text is only tried when its summed
   glyph widths could fit.
2. **Islands.** With N ellipses, the kept text forms N + 1 islands: the first
   anchored at the start, the last at the end, the ones in between centred
   where they sit. Kept graphemes are handed out one at a time in proportion
   to the positions, so every island only grows as space grows. Kept parts are
   added on top, and each gap left over becomes an ellipsis. A gap beside a
   kept part that would hide three letters or fewer is shown instead, its room
   taken from the nearest other gap. A gap no wider than the ellipsis that
   would replace it is shown too.
3. **Balance.** Glyphs are measured on a canvas at 128px and scaled down,
   because browsers round glyph boxes to whole pixels. Gaps between ink edges
   are computed with kerning ignored, and margins on the ellipsis make both
   gaps equal the target. The ellipsis is drawn on a canvas and scanned for
   the empty columns between its dots, which gives the dot rhythm and the
   position of each dot (so `markInks(t, i)` works for a single `…` glyph too).
4. **Justify.** The space left on each line holding an ellipsis goes into its
   gaps (or letter-spacing), line by line from the top, backing off by a
   fraction of a pixel if rounding would make the line wrap. Filling a line
   exactly to the edge keeps its line break where it was. Truncated text breaks
   its lines one after another, and then a line filled to a quarter pixel
   inside the edge can't move any break, so it isn't checked. (`text-wrap:
   balance` and `pretty` break them with the paragraph in view, evening them
   out; truncated text fills every line to the edge, so there's nothing to
   even out, and they would only move the breaks after the cut is fitted. So
   while truncated, the element's `text-wrap-style` is held at `auto`; text
   that fits wraps as the page says.) A cut
   judged on one line is justified from where it is expected to end, in the
   same write as rendering it, so the layout that checks the judgement checks
   the justified line too (and if it ends more than a tenth of a pixel off the
   edge, it's justified again from where it does). No gap grows past
   `maxGap`: room a long wrapping word leaves behind stays at the line's end.
5. **Stability.** While truncated, the ellipsis keeps its place in the DOM and
   only its neighbours change, so animations and hover state survive resizes.
   When truncating changes the element's height inside the resize observer's
   callback, the observer looks away for a frame, avoiding "ResizeObserver
   loop" errors. The element's height also holds while it resizes: before the
   observer runs, the browser lays out the old text at the new width, and a
   wrapping line would grow the element for that unpainted moment, enough for
   scroll anchoring to fire a scroll on every frame. So a single line never
   wraps, truncated multi-line text holds its height between passes (an inline
   `height`, restored on `destroy()`), and probing while fitting happens with
   the height held and overflow clipped. (Holding it also makes those layouts
   cheaper: a grid sizes a row by an item of fixed height without laying out
   its text a second time.) A resize that leaves plain text on as many lines
   keeps the height it holds without measuring it again.

## Batching

Reading layout after changing the DOM forces a layout, and in a long list each
costs more with every row: truncating one instance after another costs the
square of the row count. So every pass alternates between reading and writing,
and passes run in lockstep: all read, then all write, and one layout serves
them all. Passes are queued in a microtask; reading from an instance flushes
its pending pass. One ResizeObserver serves every instance, and an
IntersectionObserver puts off elements more than a screen away, when what they
show meanwhile can't change their height. Inside content that
`content-visibility: auto` skips, an instance waits until it is rendered.

Creating 900 instances, or resizing the grid they're in, takes a handful of
layouts; the browser tests count them. A resize of one-line text usually takes
one layout besides the browser's own: every pass renders what it judged and
justifies it in one write, and one read checks them all. The fastest setup for long lists is CSS
grid rows with `content-visibility: auto`, which the browser doesn't lay out
off screen, whereas a `<table>` lays out every row whenever one changes. The
demo's table page shows both.

## Entry points

What only some pages use lives in its own entry, so the rest don't ship it:
geometry, glyph mode, suffixes and `onChange`. Their code isn't reachable
from the `Elide` class, so bundlers leave it out. The `glyphs` and `suffix`
options take an object that brings the code with it, as `snap` does.
Geometry and `onChange` take the instance. They reach its internals through
`inside.ts`, which the class fills in when it loads, so an add-on doesn't
import the class. A pass calls the hook `onChange` installs. It records where
glyphs and marks were painted in the pass's own last read, which other
passes share, so it costs no layout of its own.

## Drawn marks

`count` can be anything from 0 up. With no marks, the cut still leaves a gap
the size of the font's dot rhythm, balanced and justified like any other. The
spacing defaults to the font's own ellipsis rhythm, scaled to the mark size.

## Highlights and markup

What's beside an ellipsis is kept with it, so the two never part across lines.
A highlight or inline element next to an ellipsis therefore comes in pieces:
as much as can go with the ellipsis (all of it on one line, up to a space on
more), so a piece is seldom a lone letter. Overlapping highlights get both
classes; in glyph mode the class goes on each glyph.

Each visible part of the line sits inside shallow copies of its elements: a
link cut by an ellipsis is a link on both sides, and a highlight inside a link
is inside a copy of the link. Copies have no `id`, are out of the tab order,
and lack the original's listeners; events bubble from them. `<br>` is a space.

A class or element that changes the font (bold, say) is still measured, but
the gaps around an ellipsis are planned with the element's own font.

## Snapping

Each side of a cut moves to a boundary, and separators next to the cut stay
visible. Moving both sides hides more than the plain cut, and the room that
frees ends up in the gaps around the ellipsis. So one side may keep a fragment
of its segment instead (`'head'` prefers the start of the segment the cut
begins in, `'tail'` the end of the one it stops in, each falling back to the
other). The fragment takes the room the other side gave up, through as many
segments as it covers. Fewer than `min` graphemes (default 3) of a segment are
never shown. A side with no separator in reach keeps the plain cut, and is the
fragment.

Where whole segments go (`fragment: false`, or when neither side has room for
a fragment), it's the shortest run of whole segments that hides enough. A
shorter run a little further from the cut wins over a longer one right at it
(each six graphemes it moves counts as one more left over), but a cut never
moves past the cuts either side, nor takes the start or end of the text unless
it was already there.

## Find in page

What each ellipsis hides is kept beside it in a `hidden="until-found"` copy.
Nobody searches in the middle of a resize, so the copies are filled once
passes pause for a fifth of a second (at once while find in page is keeping a
match in sight, or when anything is read from the instance). With
`find: false` the copy is out of the document until `expand()` shows it,
which saves every layout of a crowded table a little.
Browsers don't tell a page what was searched, but they do say which hidden
element a match starts in, so each word of the copy is an element of its own:
with `find: 'keep'`, that word is kept as if it were in `keep`, with an
ellipsis either side if need be.

The screen-reader copy of the full text is generated content (`::before`),
which screen readers read and find in page doesn't search, so a match in
visible text counts once.

Two known gaps:

- With `find: 'keep'`, the next Enter after a kept match lands on the kept word
  again. The browser searches on from where the match was, in the hidden copy,
  and the kept word is drawn after that. `find: 'expand'` doesn't have this.
- A word an ellipsis cuts in two isn't found: with `lan…` showing, `lantern`
  isn't, because `lan` is in the line and `tern` in the hidden copy, and a
  match can't span both.

## Suffixes and expanding

A suffix is glued to the text's last line, and the text is cut to leave it
room; its own spacing (a margin) is yours. When its width changes, the text
fits again. `expand()` keeps the cut, so collapsing is quick, and an expanded
instance doesn't re-truncate on resize. Focus reaching a link the cut hides
keeps it in sight while focused, or expands the text with `find: 'expand'`.

## `elideText`

It sums glyph widths to find the cut, then measures the result, so kerning is
accounted for. It measures with a canvas in `font` (an `OffscreenCanvas` in
workers) or with `measure`. `keep` classes are ignored, since a string has no
room for them.

## Frameworks

Options are compared by value, so inline arrays and patterns don't
re-truncate on every render, and keys left out go back to their defaults. A
`snap` made inline is new each time and does re-truncate. The instance owns the
element's content, so text rendered as children would fight it. With
`useElide`, `v-elide` or the Svelte action, server-render the text yourself
with `data-elide-fallback`; the instance takes the element over when it mounts
and marks it `data-elide`, which turns the fallback off. `elideOf(el)` from
`floating-ellipsis/vue` gives the instance behind a `v-elide`.

## Transitions

With `'merge'`, a leaving glyph shrinks into the nearest mark: glyphs on the
left into the left dot, on the right into the right one, big jumps spread
across the middle dots. On the way it takes the ellipsis' colour and
cross-fades into the mark's shape. Arriving glyphs grow back out the same way.

Nothing moves the text itself: glyphs keep their layout positions, so the line
always ends at the edge. Ghost glyphs are drawn in an overlay beside the text
and re-placed after every pass. Dots shift with a transform, only within the
space between their neighbouring glyphs, so they never collide with text.
That space's edges glide on a critically damped spring (velocity carries over,
no overshoot), and only jumps glide; the drift of a resize follows layout.

With `pace: 'leeway'`, leaving glyphs take time in proportion to the room
their removal frees, arriving ones are compressed by how many arrive side by
side, and every effect is capped at three times the interval since the
previous change, so fast drags are instant and nothing piles up.

`transitions` can be attached at any time; the first change after it animates
from what's showing.

## Tooltips

After the first tip's delay, the next shows at once, so moving along a list
only waits once. Listeners are shared, so attaching every cell of a table is
cheap.

A growing tip starts as an exact copy of the line, dots included: every
grapheme starts where it is on screen and the hidden ones come out of their
ellipsis. Its text starts where the line's does and runs right. Past the
window's edge or `maxWidth` it wraps (after `breaks` where it can), and only
when that would leave it narrower than `aspect` does it widen to the left, as
little as it can. A full-text tip takes the text's font so its glyphs land on
the original's; it's placed so its text, not its box, sits on the line.

In a held tip, a double press selects the run between breaks and a triple
press all of it. Text selected in the original is selected in the tip too,
including all of what a touched ellipsis hides. Escape, a scroll, a press
elsewhere or a re-layout closes it.

The tip is `position: fixed` and `aria-hidden`. It lines up even when its
container is the containing block of fixed elements (a transform, filter or
`contain`), as long as it isn't scaled or rotated. WebKit doesn't kern across
element boundaries, so in Safari a tip's glyphs can sit up to a pixel off the
original's.
