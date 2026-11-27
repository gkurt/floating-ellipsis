---
packages:
  floating-ellipsis:
    type: minor
---

### A tip waits for the pointer to rest, and can open only near an ellipsis

A tip used to show once the pointer had been on its trigger for `delay`, even while the pointer kept moving. Every move now starts the wait again, so a pointer passing over truncated text doesn't open the tip. The new `hover: 'ellipsis'` option opens a full-text tip only on or near an ellipsis, within `slop` of the ellipsis' area. Once open, the tip stays open over the whole trigger. Text that is only shortened, with no ellipsis, opens the tip anywhere.
