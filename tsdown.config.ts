import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/transitions.ts'],
  format: 'esm',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
});
