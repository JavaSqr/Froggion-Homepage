import { defineConfig } from 'vite';
import { pagesPlugin } from './tools/vite-pages.js';

export default defineConfig({
  plugins: [pagesPlugin()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 800,
  },
});
