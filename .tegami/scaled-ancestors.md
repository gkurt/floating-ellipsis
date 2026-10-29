---
packages:
  'floating-ellipsis': patch
---

### Text under a scaled ancestor truncates as it would unscaled

An element inside a `transform: scale(…)` (a zoomed canvas, a scaled card) no longer truncates too early, or shows too much, and keeps its cut when the scale changes.
