---
packages:
  'floating-ellipsis': patch
---

### Several lines fit and end flush with `text-wrap: balance` or `pretty`

Truncated text breaks its lines one after another (the element's `text-wrap-style` is held at `auto` while truncated), so the ellipsis line reaches the edge and the text no longer runs a line over. Text that fits still wraps as the page says.
