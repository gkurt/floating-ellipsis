---
packages:
  'floating-ellipsis': minor
---

### Leftover room fills with more marks (`repeat`)

Cutting whole words or path segments no longer spreads the dots far apart or leaves room at the end: with any `justify` mode, more marks go in, by default three quarters as many as fit (`repeat: 0.75`). `repeat: 1` adds one wherever it fits, and `false` turns it off; `<elide-text>` takes it as an attribute.
