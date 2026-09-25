// Vite plugin: renders the pages (ru at /, en at /en/, legal stubs) from content/*.json before Vite reads them,
// and adds sitemap.xml, robots.txt and the web manifest to the build.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const WATCH = ['content', 'src/page', 'src/ui/pricing.js', 'site.config.json', 'source/bots.json'];

async function renderer() {
  return import(`${pathToFileURL(path.join(ROOT, 'src/page/render.js')).href}?t=${Date.now()}`);
}

export async function writePages() {
  const pages = (await renderer()).renderAll(ROOT);
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
      const input = Object.fromEntries(files.map((f) => [f.replace(/\/?index\.html$/, '').replace(/\//g, '-') || 'main', path.join(ROOT, f)]));
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
      // sitemap.xml, robots.txt and the manifest in development too.
      const types = { xml: 'application/xml', txt: 'text/plain', webmanifest: 'application/manifest+json' };
      server.middlewares.use(async (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].slice(1);
        const extras = /^[\w.-]+\.(xml|txt|webmanifest)$/.test(name) ? (await renderer()).renderExtras(ROOT) : {};
        if (!(name in extras)) return next();
        res.setHeader('Content-Type', `${types[name.split('.').pop()]}; charset=utf-8`);
        res.end(extras[name]);
      });
    },
    async generateBundle() {
      const extras = (await renderer()).renderExtras(ROOT);
      for (const [fileName, source] of Object.entries(extras)) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
