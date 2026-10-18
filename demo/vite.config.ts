import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// The demo is three pages: the home page, the crowded table, and elements sized by their content.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: { index: page('index.html'), table: page('table.html'), autosize: page('autosize.html') },
    },
  },
});
