---
packages:
  'floating-ellipsis': minor
---

### `<Elided instanceRef>`, for the add-ons

`<Elided>` hands its instance to `instanceRef` once its element mounts, so a tooltip, transitions or `onChange` from the add-ons can attach to it: `instanceRef={(t) => tips.attach(t)}`. A callback may return its cleanup.
