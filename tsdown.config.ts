import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
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
});
