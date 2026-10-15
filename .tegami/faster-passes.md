---
packages:
  'floating-ellipsis': patch
---

### Truncating is faster, with fewer layouts

Single-line cuts are judged from glyph widths and kerning without rendering them, and less work is redone on every pass: refreshing a crowded table takes about half the time and layouts, and resizing one or setting new text about a fifth less. Long text and several lines gain the most.
