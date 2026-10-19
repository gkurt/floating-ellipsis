import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/geometry.ts',
    'src/glyphs.ts',
    'src/changes.ts',
    'src/suffix.ts',
    'src/list.ts',
    'src/input.ts',
    'src/autosize.ts',
    'src/transitions.ts',
    'src/tooltip.ts',
    'src/text.ts',
    'src/element.ts',
    'src/react.ts',
    'src/vue.ts',
    'src/svelte.ts',
  ],
  format: 'esm',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  copy: ['src/fallback.css'],
  // Rolldown keeps an entry's directive; it only can't promise to for the modules it inlines.
  suppressWarnings: /"use client"/,
});
