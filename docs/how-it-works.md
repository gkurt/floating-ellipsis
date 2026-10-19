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
   because browsers round glyph boxes to whole pixels. Where the canvas
   doesn't say where a glyph's ink is (WebKit on Linux and Windows gives the
   advance box), the glyph is drawn and scanned for it instead. Gaps
   between ink edges are computed with kerning ignored, and margins on the
   ellipsis make both gaps equal the target. The ellipsis is drawn on a
   canvas and scanned for the empty columns between its dots, which gives the
   dot rhythm and the position of each dot (so `markInks(t, i)` works for a
   single `…` glyph too).
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
   edge, it's justified again from where it does). A cut judged beside one
   the pass has measured goes unchecked, unless judgements of that font have
   been off by more than that tenth of a pixel (as in WebKit on Linux). No
   gap grows past `maxGap`: room a long wrapping word leaves behind stays at
   the line's end.

   With `repeat`, marks go into that room first, copies of the ellipsis' last
   (so only marks that are all the same repeat: drawn ones, `'...'`, and a
   single `'…'`, which is drawn as dots for it). How many is `repeat`'s share
   of as many as would fit at the marks' own spacing, the ellipsis' own
   counted, rounded down and never fewer than its own: with the default
   0.75, three dots stay three until six would fit, then four, five at
   seven, six at eight. So a few more letters of room only widen the gaps a
   little, rather than bringing a dot in and out at every glyph as the box
   resizes, and a long run of marks settles a third sparser than the
   ellipsis' own. With `justify: 'dots'` every gap stays even; where they
   would grow past `maxGap`, one more goes in and they close up a little. With
   `'ellipsis'` (and `'spread'` on more than one line) they go in spaced like
   the other marks, and the two gaps around them take the rest, up to
   `maxGap`, then the gaps between the marks. With `'spread'` they go in
   before the letter-spacing, which spreads only what's left; with `false`
   what's too little for one more stays at the line's end. Layout rounds
   each mark's size and margins to its units (1/64 px, 1/60 in Firefox),
   which would add up over many marks and leave the line off where it was
   expected to end. So drawn marks are sized in whole units, and each one's
   place is rounded rather than each margin, so they add up exactly. A text
   mark's width can't be set like that: a line with text marks added is read
   once more, and what's off goes into its last ellipsis' gaps. The cut is the same as without `repeat`, except that
   a single `'…'` drawn as dots is a hair narrower.

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

## Places along the line

A share of the text hands kept graphemes to the islands by count, so the
ellipsis lands wherever the text before it ends. A place (`'50%'`,
`'120px'`, `'8em'`) sizes the islands by width instead: on one line, the
first is as long as its glyph widths (with kerning, and the ink of its last
glyph) keep it short of the place, less half the ellipsis and the gap it
wants; one between two places is centred where it sits in the text, as long
as fits between them; the last takes the rest. The search fills them in
turn, so it only looks for how much of the end fits, and judging cuts from
glyph widths works as on any line. Where the place falls inside a glyph, the
text before it stops a glyph short, and the ellipsis follows it there; white
space beside the cut goes with it. `keep`, `snap` and `justify` work as
usual, so they can move the ellipsis further: a snapped cut by a segment, the
room `justify` spreads by a part of a glyph.

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
geometry, glyph mode, suffixes, lists, auto-sizing and `onChange`. Their code isn't reachable
from the `Elide` class, so bundlers leave it out. The `glyphs`, `suffix` and `autoSize`
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

### Units

An image, an icon or an element marked `data-elide-unit` is one grapheme
whatever its text: its `alt` or `aria-label`, an element's own text, or
U+FFFC. The text around it is split into graphemes on its own, so nothing
joins onto it. The line shows a deep copy of it (the drawing of an SVG, the
markup inside a mention), kept on one line; the screen-reader copy has the
image itself, read by its alt text, or says a unit's text like the rest.
Canvas can't measure an image, so each pass reads how wide each unit's copy
is laid out in the line (one that isn't showing keeps its last width), and an
ellipsis beside one treats its box as its ink. An image that loads at another
width fits the text again. Text with units isn't judged without rendering.

## Tightening

When the full text doesn't fit and `tighten` is set, the pass tries it set
tighter before it searches for a cut. A pixel of tightening takes in a pixel
after every letter and two after every space (word spaces give more, as in
justified type), so text running over by `over` needs `over / units`, a
quarter pixel more to stay inside the edge. Over more than `tighten` allows,
it's cut straight away. On one line, that first try usually fits; when it
doesn't (layout rounds letter-spacing: Firefox to 1/60 px), how far it moved
the line says how much it takes, rounded up, and that's the last try. On more
lines, where wrapping makes the gain uneven, it tries the most it may and, if
that fits, halves between the two three times, ending on the least that
fits. It costs no layout unless the full text is within reach, and a
tightened line isn't judged without rendering: its end isn't where the glyph
widths say. How far the text runs over is always measured, never judged by
the glyph widths: near the most, a judgement and a measurement can fall on
either side of it, and which one a pass has depends on the pass before, so
deciding by either would flip a line between tightened and cut from pass to
pass as the box shrinks. Once cut, text is set as usual; tightening only
ever saves a cut, unless `tightenCuts`.

With `tightenCuts`, on one line, the search for the cut is followed by a
second, upward from the cut it found: for as many more graphemes as fit
with the line set as tight as it may. It aims by the glyph widths less
`tighten` for every unit, as the first search aims by the glyph widths, and
renders every probe set that tight. The cut it ends on is then set as
little tighter as it takes, as the full text is (by how far it would run
over, then once more by how far that moved it). The ellipses, and the
graphemes beside them in their joins, keep the element's spacing, so the
gaps planned around them hold. The second search costs a few layouts each
pass, and a tightened line isn't judged, so the pass after it renders its
probes too. On more lines, where wrapping makes the gain uneven, and with
`justify: 'spread'`, which sets the spacing itself, cuts are set as usual.

## Snapping

Snapping and wholes come down to one thing: where a cut may start and where
it may end (`Edges`). `words()` and `separators()` let one start where a
segment starts and end where one ends; `whole` lets one start and end
anywhere but inside its matches. Rules combine by both holding, and one
search, `shortestRun`, finds the run that keeps to them: as few graphemes
over what the cut hides as it can, each six it moves away from the cut
counting as one more. So a cut through a whole slides off it, hiding as much
just beside it, rather than hide all of it and leave a wide gap; at an end of
the text, where nothing is beside it, the whole goes. With a snap, the snap
gets the whole's edges and keeps to them too, and any cut that still splits
one (a fragment, trimmed white space, a sliver paid for) is widened over it,
never into a kept part. Wholes that touch stay two, so a cut can fall between
them.

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

## Context

A kept part's `context` is a list of steps, each a word and what's between
it and the part: after the part, then before it, for each part in turn,
round after round, so every match has a word before any has two. A match
that ends inside a word gets the rest of it first. Each step costs the
graphemes it shows that weren't showing, so windows that run into each other
or into a kept part merge at no cost. The search hands out graphemes to the
steps in order, a whole step at a time, and only once every step shows to
the islands `position` places; a number of words less than `Infinity` ends
the steps sooner. What shows only grows as the room does, so it reads
steadily on a resize. Context belongs to its kept part: when kept parts give
way for lack of room, their context goes with them, and when one comes back
the others share their context with it.

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

## As many lines as fit

With `lines: 'fit'`, a line fits when its line box ends above the element's
content box, as laid out with that cut: a line box is the glyphs' box with
half the leading either side, `line-height` tall (or as tall as the glyphs
with `normal`). The full text is always tried first, and how many of its
lines fit the height is the room the search aims for. That only works while
the height is free to follow the text, so probes hold only the overflow, not
the height, and truncated text isn't held at its height between passes. A
height that changes from outside, by a flex or grid track or a style, is a
resize the ResizeObserver reports; the height the element took after the last
pass isn't. Room can also grow without the element changing size: a
`max-height` raised past the lines that show leaves the element as tall as
they are. So a box out of sight and out of the flow (`data-fp-room`) takes
the element's max-height (`max-height: inherit`) over a height too tall for
any: its height is the cap, and a second ResizeObserver reports it changing.
A cap in percent resolves against that box's own container, so it isn't
seen; `refresh()` sees it. Text always shows at least one line.

## Suffixes and expanding

A suffix is glued to the text's last line, and the text is cut to leave it
room; its own spacing (a margin) is yours. When its width changes, the text
fits again. `expand()` keeps the cut, so collapsing is quick, and an expanded
instance doesn't re-truncate on resize. Focus reaching a link the cut hides
keeps it in sight while focused, or expands the text with `find: 'expand'`.

### Animating "Read more"

The element's height can follow the toggle: opening, the box grows over the
full text; closing, the text is cut at once, the button already in place, and
the room it leaves closes up below it. (The demo's `toggleSmoothly`, in
`demo/examples.ts`.)

```js
function toggle(t) {
  const el = t.element;
  if (el.getAnimations().length > 0) return; // the button is clickable mid-way
  const from = el.getBoundingClientRect().height;
  const opening = !t.expanded;
  t[opening ? 'expand' : 'collapse']();
  void t.state; // runs the pass the change put off
  t.refresh(); // the label changed its width: fit that now, too
  void t.state;
  const to = el.getBoundingClientRect().height;
  const motion = { duration: 480, easing: 'ease-out' };
  if (!opening) {
    const held = parseFloat(getComputedStyle(el).height);
    el.animate({ minHeight: [`${held + from - to}px`, `${held}px`] }, motion);
    return;
  }
  el.style.overflow = 'clip';
  el.animate({ height: [`${from}px`, `${to}px`] }, motion).finished.then(() => (el.style.overflow = ''));
}
```

Two things make closing differ from opening:

- Cut text on several lines holds its height with an inline
  `height: … !important` (see [Stability](#a-layout-pass)), which overrides any
  animation of `height`. A larger `min-height` overrides the held height, so
  that's what shrinks. `margin-bottom` would collapse into the next element's
  margin, and most of the motion would be lost.
- A label set in `onRender` ("Show less" to "Read more") changes the suffix's
  width, and the text fits again in a pass a microtask later. Run during the
  animation, that pass would measure the element at its `min-height` and hold
  that. `refresh()` and reading `state` run it first.

## Lists

`list()` is made of options the core already has. Its `snap` moves a cut
from the end to the end of the last item before it, so items go whole, and
its `suffix` is the label. A suffix is measured with the line, and each pass
shows it with the cut it is trying, before measuring; so every probe is
measured with its own label, `+9` and `+10` alike, and a label that changes
width costs no layout of its own. The search starts from the label the last
pass showed. A suffix that only shows while truncated isn't counted when
the pass tries the full text, which it doesn't show beside.

Items are found in the text in order, each after the one before, so the same
name twice is two items; what lies between them is a separator. An array is
joined by `format`, and the label is joined as `format` joins a last item to
the ones that show (`formatToParts`, so "Ada and 3 more" but "Ada, Grace,
and 2 more"); found in the text, it takes the text's last separator. When no
item fits whole, the first is cut, and fewer than three of its graphemes
aren't shown.

The label is generated content (`::after`), hidden from screen readers,
which read the full text: find in page doesn't find it, and copying leaves
it out. Find in page on a hidden item expands the list (`find: 'expand'`),
and an expanded list hides its label. `keep` doesn't go with a list: a kept
part among the hidden items shows without the separators around it.

## Sized by content

An element sized by its content (an inline-block, a float, an absolutely
positioned element, a flex item's basis, a `max-content` grid track) takes its
width from what shows. A pass reads that width and cuts the text to it, so the
cut sets the width the next pass reads: the element shrinks with the room but
never grows back, and new, longer text is cut to the old width.

`autoSize()` breaks the loop with a copy of the full text in the element: a
block of no height, invisible, inert and hidden from screen readers. It is
filled the way the line is when it shows everything (copies of the inline
elements, `keep` classes), with a copy of a suffix that always shows, so it
takes the room the full text would. Its max-content width is the full text's,
and its min-content width the longest word's, as if the text were all there,
so the element is as wide as the full text up to the room it has, and wraps
to fit with nothing capping it. A resize that gives it more room changes its
width, so the ResizeObserver reports it as it does any other.

The copy comes first in the element, so its lines can't give an inline-block
its baseline (the last line's), and layout containment keeps them from giving
the element its first, which flex and grid items align by.

The line still counts towards the element's size. Kept on one line so it
never wraps while the element narrows, a cut is as wide in its min-content
as it is shown, so on one line the element only shrinks below it when
something caps it (`max-width: 100%`, or `min-width: 0` on a flex item), as
with `text-overflow`. The copy costs no layouts of its own: it is laid out in
the layouts passes share, which takes a little longer with the text in twice.
It holds the content as elements and text, so what a style gives the copy
that it doesn't give the line (a selector on the line's own attributes) can
make them differ.

## `elideText`

It sums glyph widths to find the cut, then measures the result, so kerning is
accounted for. It measures with a canvas in `font` (an `OffscreenCanvas` in
workers) or with `measure`. `keep` classes are ignored, since a string has no
room for them. `tighten` is in `measure`'s unit, and `tightened` is the
letter-spacing to take off when drawing (twice that on spaces). With
`tightenCuts`, that applies to the whole string, the ellipsis too: a cut
fits if its width less `tighten` for each of its letters (three for a
space) does.

## Frameworks

Options are compared by value, so inline arrays and patterns don't
re-truncate on every render, and keys left out go back to their defaults. A
`snap` made inline is new each time and does re-truncate. The instance owns the
element's content, so text rendered as children would fight it. With
`useElide`, `v-elide` or the Svelte action, server-render the text yourself
with `data-elide-fallback`; the instance takes the element over when it mounts
and marks it `data-elide`, which turns the fallback off. `elideOf(el)` from
`floating-ellipsis/vue` gives the instance behind a `v-elide`.

A `suffix` given to `<Elided>` as a node is rendered with a portal into a
span the instance moves after the line; the suffix watches it change size,
as it does any node. The portal is left out while hydrating, which has none
to match, so a node suffix shows once the page has hydrated. A string goes in
as it is.

Every entry imports on a server without a DOM: nothing touches `document` until
an instance is made, and `ElideElement` extends a stand-in class where
`HTMLElement` doesn't exist (`define()` does nothing there). The React entry
starts with `'use client'`, which the build keeps, so React Server Components
(Next.js's App Router) treat `Elided` and `useElide` as a Client Component
instead of failing on their hooks. A Server Component's props to it cross the
network as React's serialized props, so functions and RegExps can't: a
string `keep` can.

`Elided` gives its element to a `ref` through `useImperativeHandle`, apart from
the binding's own ref callback. Radix's `asChild` and Base UI's `render` merge
their refs into the child's, and a parent may hand a new ref every render;
folding that into the binding's callback would make React detach and attach
it, remaking the instance each time.

`instanceRef` gets the instance through `useImperativeHandle` as well, given
the ref only once there is an instance, so a callback never sees `null` before
it and its cleanup (or a call with `null`) comes when the instance goes. The
add-ons all return a function that undoes them, so a callback can return
`tips.attach(t)` as is. React treats a new callback as a new ref, detaching and
attaching again, so it should be stable.

## Transitions

With `'merge'`, a leaving glyph shrinks and fades towards the dots' line,
taking the ellipsis' colour; arriving glyphs grow back the same way. A glyph
on its way in or out never overlaps the text, the marks or another glyph. It
stays in its own place (a leaving one moves with the text on its side) and
every frame gets only what is left of that place between the text and the
marks as drawn; it shrinks to fit, so the dots spreading into freed room
squeeze it out as they go, and it is gone once less than a pixel is left.
Neighbours whose ink overlaps, like an `f` reaching over the next letter,
split the overlap down the middle. `'fade'` and `'blur'` play in place and
shrink only when squeezed. A glyph that turns around mid-way (shown again
while leaving, or hidden while arriving) carries on from where it is.

Nothing moves the text itself: glyphs keep their layout positions, so the line
always ends at the edge. Ghost glyphs are drawn in an overlay beside the text
and re-placed after every pass and on every frame while they play. Dots shift with a transform: each ellipsis
stays centred where layout puts it, and only the spacing between its dots
glides, on a critically damped spring (velocity carries over, no overshoot).
Every gap, outer ones included, takes the same share of the width as drawn,
so a jump in the cut doesn't bunch the dots together.
Next to a glyph that's showing, the dots keep at least half the gap layout
gives them, so they never crowd the text. Only jumps glide; the drift of a
resize follows layout.

Leaving glyphs take time in proportion to the room their removal frees,
capped at three times the interval since the previous change, so fast drags
are instant and nothing piles up. Arriving glyphs always take `duration`:
each grows in its own place, so there is nothing for them to run into. The
dots spread into freed room as the glyphs there shrink, which is what
squeezes them out.

`transitions` can be attached at any time; the first change after it animates
from what's showing.

## Text fields

`elideInput` doesn't touch the value. It puts an element after the field,
over its border box (anchored with CSS anchor positioning, or moved into
place where that's missing), with the field's padding, border widths and
typography, and a line as tall as the field's content box, which centres the
text as a field does. An instance cuts the value in it. While it shows, the
field's own text is hidden with `-webkit-text-fill-color`, which leaves
`color` (and the caret) alone; its native placeholder is always hidden that
way, and the copy shows it cut, in the placeholder's colour and opacity. The
copy is inert and hidden from screen readers, so find in page and assistive
technology see the field alone.

A press is caught on `pointerdown`, before the browser places the caret: the
copy says which glyph boundary is nearest the pointer (either side of what a
pressed ellipsis hides, by which half was pressed), the field's own text is
shown, and it's scrolled so that boundary lies under the pointer, from the
canvas width of the value before it. The browser's own press then puts the
caret there, and a drag selects from it. Beside an ellipsis the field can't
always scroll that far (the copy's gaps aren't in the field's text): then the
caret goes there when the press ends, unless it selected something. A touch
places it on focus. A press the page cancels leaves the copy showing.

The value changes without events when a script sets it: the field's own
`value` property is wrapped (over whatever was there, such as React's
tracker, which still runs), and a form's reset is followed. A field whose
type turns to `password` hides the copy at once.

## Tooltips

After the first tip's delay, the next shows at once, so moving along a list
only waits once. Listeners are shared, so attaching every cell of a table is
cheap.

A growing tip starts as an exact copy of the line, dots included: every
grapheme showing starts where it is on screen and moves to make room. The
room grows first: the hidden text waits where it lands, and fades in once the
tip has nearly grown. Its text starts where the line's does and runs right. Past the
window's edge or `maxWidth` it wraps (after `breaks` where it can), and only
when that would leave it narrower than `aspect` does it widen to the left, as
little as it can. A full-text tip takes the text's font so its glyphs land on
the original's; it's placed so its text, not its box, sits on the line.

In a held tip, a double press selects the run between breaks and a triple
press all of it. Text selected in the original is selected in the tip too,
including all of what a touched ellipsis hides. Escape, a scroll, a press
elsewhere or a re-layout that moves the text closes it. A pass that leaves
the text where it was (the same cut, gaps within a quarter pixel) doesn't:
every instance refits when any web font loads, often one the text doesn't
use, and a tip shouldn't close under the pointer for that.

The tip is `position: fixed` and `aria-hidden`. It lines up even when its
container is the containing block of fixed elements (a transform, filter or
`contain`), as long as it isn't scaled or rotated. WebKit doesn't kern across
element boundaries, so in Safari a tip's glyphs can sit up to a pixel off the
original's.
