---
packages:
  'floating-ellipsis': major
---

### Geometry, glyph mode, suffixes and `onChange` move to their own entries

The core is about 2 kB smaller gzipped. Pages that use them import them: `floating-ellipsis/geometry` (`ellipsisRect(t, i)`, `graphemeAt(t, …)` and the other box methods, as functions; `marks(i)` is now `markInks(t, i)`), `floating-ellipsis/changes` (`onChange(t, fn)`, replacing the method and option; bindings keep `onChange`), `floating-ellipsis/glyphs` (`glyphs: glyphs` in place of `glyphs: true`, and `glyph(t, i)`, `glyphInk(t, i)`) and `floating-ellipsis/suffix` (`suffix: suffix(content, { show })`, replacing `suffix` and `showSuffix`).
