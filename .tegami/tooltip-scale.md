---
packages:
  'floating-ellipsis': minor
---

### Tooltips over text under a scaled ancestor

A full-text tip (`reveal: 'grow'` or `'expand'`) over text under a `transform: scale()`, such as a zoomed canvas, is drawn at the text's scale, so its glyphs land on the original's at their size, and it grows, wraps and selects as it does unscaled. Any tip now closes once its text moves or changes size on screen, as when a canvas pans or zooms under it.
