---
packages:
  'floating-ellipsis': patch
---

### Crowded tables and several lines truncate with fewer layouts

Resizing a table of one-line cells takes one layout per frame besides the browser's own, text on several lines about half the layouts it did, and highlighted text is judged without rendering when the highlights only colour it. `find: false` now keeps what an ellipsis hides out of the document, which makes every layout a little cheaper.
