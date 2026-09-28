// Texture pack: every texture under public/textures/ and every skin under public/skins/ in one PNG,
// so the scene loads them with one request instead of a hundred. The files themselves stay as they are
// (an artist replaces a file, the next build packs it); the site serves the pack at data/textures.png
// with its map at data/textures.json.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCES = [['textures', ''], ['skins', 'skins/']];
export const PACK_PNG = 'data/textures.png';
export const PACK_JSON = 'data/textures.json';

const walk = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  : []);

// Shelves across a fixed width, tallest images first; names map to [x, y, w, h].
export function packTextures(root = ROOT, width = 256) {
  const images = [];
  for (const [dir, prefix] of SOURCES) {
    const base = path.join(root, 'public', dir);
    for (const file of walk(base).filter((f) => f.endsWith('.png')).sort()) {
      const name = prefix + path.relative(base, file).split(path.sep).join('/').replace(/\.png$/, '');
      images.push({ name, png: PNG.sync.read(fs.readFileSync(file)) });
    }
  }
  images.sort((a, b) => b.png.height - a.png.height || b.png.width - a.png.width || (a.name < b.name ? -1 : 1));
  const map = {};
  let x = 0, y = 0, shelf = 0;
  for (const im of images) {
    const { width: w, height: h } = im.png;
    if (w > width) throw new Error(`${im.name} is wider than the pack`);
    if (x + w > width) { x = 0; y += shelf; shelf = 0; }
    map[im.name] = [x, y, w, h];
    x += w;
    shelf = Math.max(shelf, h);
  }
  const out = new PNG({ width, height: Math.max(1, y + shelf) });
  for (const im of images) {
    const [px, py] = map[im.name];
    PNG.bitblt(im.png, out, 0, 0, im.png.width, im.png.height, px, py);
  }
  return { png: PNG.sync.write(out, { colorType: 6, deflateLevel: 9, filterType: -1 }), json: JSON.stringify(map) };
}

// Vite: the pack in the build, and on the fly in development.
export function texturePackPlugin() {
  let base = '/';
  return {
    name: 'froggion-texture-pack',
    configResolved(config) { base = config.base; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const name = url.startsWith(base) ? url.slice(base.length) : url.slice(1);
        if (name !== PACK_PNG && name !== PACK_JSON) return next();
        const pack = packTextures();
        res.setHeader('Content-Type', name === PACK_PNG ? 'image/png' : 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(name === PACK_PNG ? pack.png : pack.json);
      });
    },
    generateBundle() {
      const pack = packTextures();
      this.emitFile({ type: 'asset', fileName: PACK_PNG, source: pack.png });
      this.emitFile({ type: 'asset', fileName: PACK_JSON, source: pack.json });
    },
  };
}
