---
packages:
  'floating-ellipsis': patch
---

### Truncate text a fast scroll brings near before the frame paints

Text more than a screen from the window waits to be truncated until the IntersectionObserver says the text came near. The observer reports a frame or two after a scroll, so text that a fast scroll brought straight into sight showed in full for those frames, and the ellipsis settled late. A scroll event now runs the waiting passes of the text the scroll brought near, before the frame paints, so the text shows truncated from the first frame. A pass that runs there lands at once, with no animation from `floating-ellipsis/transitions`.
