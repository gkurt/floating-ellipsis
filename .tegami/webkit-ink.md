---
packages:
  'floating-ellipsis': patch
---

### Drawn marks and gaps sized right in WebKit on Linux and Windows

Where the canvas doesn't report glyph ink, it is read off a drawing, so bullets and rings are no longer twice their size there.

### Lines end flush where cuts judged without rendering are a little off

A judged cut is checked when the font's judgements have been off by more than a tenth of a pixel.
