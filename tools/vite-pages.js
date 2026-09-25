// Vite plugin: renders index.html (ru) and en/index.html from content/*.json before Vite reads them.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const WATCH = ['content', 'src/page', 'site.config.json', 'source/bots.json'];

export async function writePages() {
  const mod = await import(`${pathToFileURL(path.join(ROOT, 'src/page/render.js')).href}?t=${Date.now()}`);
  const pages = mod.renderAll(ROOT);
  for (const [file, html] of Object.entries(pages)) {
    const out = path.join(ROOT, file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
  }
  return Object.keys(pages);
}

export function pagesPlugin() {
  return {
    name: 'froggion-pages',
    async config() {
      const files = await writePages();
      const input = Object.fromEntries(files.map((f) => [f.replace(/\/?index\.html$/, '') || 'main', path.join(ROOT, f)]));
      return { build: { rollupOptions: { input } } };
    },
    configureServer(server) {
      server.watcher.add(WATCH.map((p) => path.join(ROOT, p)));
      server.watcher.on('change', async (file) => {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (!WATCH.some((p) => rel === p || rel.startsWith(`${p}/`))) return;
        await writePages();
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}
