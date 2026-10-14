import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// The demo is two pages: the home page and the crowded table.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: { index: page('index.html'), table: page('table.html') },
    },
  },
});
