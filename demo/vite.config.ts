import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// The demo is five pages: the home page, the playground, the crowded table, elements sized by their content, and the justify modes side by side.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        index: page('index.html'),
        playground: page('playground.html'),
        table: page('table.html'),
        autosize: page('autosize.html'),
        justify: page('justify.html'),
      },
    },
  },
});
