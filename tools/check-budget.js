// Weight of the home page after `vite build`: everything it downloads except three.js and the skins,
// scene data included, in gzip (images and fonts count as they are). Fails above the budget.
//   node tools/check-budget.js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUDGET = 300 * 1024;
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sizeOf = (file) => {
  const buf = fs.readFileSync(file);
  return Math.min(buf.length, zlib.gzipSync(buf, { level: 9 }).length);
};
const rel = (file) => path.relative(DIST, file).split(path.sep).join('/');
// Built with BASE_PATH (GitHub Pages), page URLs start with it.
const BASE = `/${process.env.BASE_PATH || '/'}/`.replace(/\/+/g, '/');
const inDist = (url) => path.join(DIST, (url.startsWith(BASE) ? url.slice(BASE.length) : url.replace(/^\//, '')).split('?')[0]);

function pageWeight(htmlFile, { live }) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const files = new Set([htmlFile]);
  const attr = (re) => [...html.matchAll(re)].map((m) => m[1]);
  // Styles, scripts, the poster preload (the larger, landscape one), icons and the manifest.
  for (const u of attr(/<link[^>]+rel="(?:stylesheet|modulepreload|manifest|icon)"[^>]*href="([^"]+)"/g)) files.add(inDist(u));
  for (const u of attr(/<link[^>]+href="([^"]+)"[^>]*rel="(?:stylesheet|modulepreload|manifest|icon)"/g)) files.add(inDist(u));
  for (const u of attr(/<script[^>]+src="([^"]+)"/g)) files.add(inDist(u));
  for (const u of attr(/<img[^>]+src="([^"]+)"/g)) files.add(inDist(u));
  const assets = walk(path.join(DIST, 'assets'));
  // Fonts: the ones the stylesheet can ask for. Other chunks: the scene, but never three.js.
  for (const f of assets) {
    if (/\.(woff2?|js)$/.test(f) && !/three-/.test(path.basename(f))) files.add(f);
  }
  const night = config.scene?.variant === 'night';
  for (const f of [...files]) {
    const name = rel(f);
    // Only one variant of the stills is shown; stills of the stations only without the live scene.
    if (/^stations\//.test(name) && (live || /-night/.test(name) !== night)) files.delete(f);
    if (/-560\.webp$/.test(name)) files.delete(f);
  }
  if (live) {
    for (const f of walk(path.join(DIST, 'data'))) files.add(f);
    for (const f of walk(path.join(DIST, 'textures'))) files.add(f);
  } else {
    for (const f of assets) if (/scene-.*\.js$/.test(path.basename(f))) files.delete(f);
  }
  const list = [...files].filter((f) => fs.existsSync(f)).map((f) => ({ name: rel(f), size: sizeOf(f) }));
  return { total: list.reduce((s, f) => s + f.size, 0), list };
}

let failed = false;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const lang of config.languages) {
  const file = path.join(DIST, lang.path.replace(/^\//, ''), 'index.html');
  for (const live of [true, false]) {
    const { total, list } = pageWeight(file, { live });
    const groups = {};
    for (const f of list) {
      const g = /\.(woff2?)$/.test(f.name) ? 'fonts' : /\.js$/.test(f.name) ? 'js' : /\.css$/.test(f.name) ? 'css'
        : /^data\//.test(f.name) ? 'scene data' : /^textures\//.test(f.name) ? 'textures' : /\.html$/.test(f.name) ? 'html' : 'images';
      groups[g] = (groups[g] ?? 0) + f.size;
    }
    const ok = total <= BUDGET;
    failed ||= !ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${lang.path} ${live ? 'with the 3D scene' : 'without the scene'}: ${kb(total)} of ${kb(BUDGET)} (${Object.entries(groups).map(([g, s]) => `${g} ${kb(s)}`).join(', ')})`);
  }
}
if (failed) process.exit(1);
