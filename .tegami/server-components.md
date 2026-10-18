---
packages:
  'floating-ellipsis': minor
---

### React Server Components, and `<Elided>` as an `asChild` or `render` child

`floating-ellipsis/react` is marked `'use client'`, so Next.js Server Components render `<Elided>` without a wrapper; `<Elided>` passes its `ref` to its element, so Radix's `asChild` and Base UI's `render` can use it as their trigger; and `floating-ellipsis/element` imports on a server.
