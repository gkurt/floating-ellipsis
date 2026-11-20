---
packages:
  'floating-ellipsis': patch
---

### Truncate text in a scrolling list before the list scrolls it into sight

Text more than a screen from the window waits to be truncated until the text comes near. Text in a scrolling container, below what the container shows, counted as far until the text scrolled into sight, and the ellipsis settled a frame later. The text now counts as near within a container's height of what the container shows (`scrollMargin`), so the text is truncated before it shows. Firefox, without `scrollMargin`, works as before.
