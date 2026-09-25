import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { pagesPlugin } from './tools/vite-pages.js';

// Version tag for files in public/ (scene data, textures, skins) so browsers pick up a new build.
function buildId() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() + '-' + Date.now().toString(36);
  } catch {
    return Date.now().toString(36);
  }
}

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow passes that path in BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [pagesPlugin()],
  // Static pages: an unknown address is a 404, as on the server, not the home page.
  appType: 'mpa',
  define: { __BUILD__: JSON.stringify(buildId()) },
  build: {
    target: 'es2020',
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // three.js in its own file: it is loaded after the first paint and kept out of the size budget.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          return undefined;
        },
      },
    },
  },
});
