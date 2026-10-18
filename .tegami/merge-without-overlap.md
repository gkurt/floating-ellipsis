---
packages:
  'floating-ellipsis': patch
---

### Glyphs on their way in or out never overlap

With `transitions`, a glyph that leaves stays in its own place, shrinking and fading in whatever room the text and the dots leave it, and goes at once when none is left. It no longer turns into a dot or slides over the others. Arriving glyphs grow in their place the same way, and the dots keep their spacing when the cut jumps. The `pace` and `marks` options are gone: leaving glyphs always take less time when squeezed or dragged fast, arriving ones always take `duration`, and the dots always move with the glyphs.
