---
packages:
  'floating-ellipsis': patch
---

### Popovers and menus open with their ellipses in place

`transitions` animates only once the element has been on screen, and an element shown again after `display: none` is truncated before it paints, instead of a frame later.
