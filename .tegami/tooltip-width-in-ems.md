---
packages:
  'floating-ellipsis': patch
---

### Tooltips are as wide as a readable line, not half the window

The tooltip's `maxWidth` is now in ems of the text (default `40`) instead of a fraction of the window, so a tip can use a narrow window's whole width. Tips also show sooner and grow faster: `delay` defaults to `300` and `duration` to `240`.
