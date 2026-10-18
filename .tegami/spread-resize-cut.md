---
packages:
  'floating-ellipsis': patch
---

### A spread line shows as much text after a resize as it would fresh

With `justify: 'spread'`, the letter-spacing left from the last width no longer widens the ellipsis as measured, which made a resized line hide more than fits.
