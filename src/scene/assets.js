// Texture loading and the block atlas. Every texture is its own file under /textures/; the build packs them
// all, skins included, into data/textures.png (tools/texture-pack.js), which the scene loads in one request.
// This module is small and has no three.js in it: the page starts loading the scene data right away.
export const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;
const DATA = `${import.meta.env.BASE_URL}data/`;
/* global __BUILD__ */
const VERSION = typeof __BUILD__ === 'string' ? __BUILD__ : '';
// Files in public/ keep their names between builds; the version query makes a new build visible at once.
export const versioned = (url) => (VERSION ? `${url}${url.includes('?') ? '&' : '?'}v=${VERSION}` : url);
const fetchJson = (u) => fetch(versioned(u)).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });

// Name → image for everything in the pack; an empty map when there is none (textures then come one by one).
async function loadPack() {
  try {
    const [map, blob] = await Promise.all([
      fetchJson(`${DATA}textures.json`),
      fetch(versioned(`${DATA}textures.png`)).then((r) => { if (!r.ok) throw new Error(`textures.png: ${r.status}`); return r.blob(); }),
    ]);
    const sheet = await createImageBitmap(blob);
    const entries = await Promise.all(Object.entries(map).map(async ([name, [x, y, w, h]]) => [name, await createImageBitmap(sheet, x, y, w, h)]));
    return new Map(entries);
  } catch (e) {
    console.warn('[froggion] no texture pack, loading textures one by one:', e.message);
    return new Map();
  }
}

// Everything the scene downloads, started at once and in parallel with three.js.
export function loadSceneData({ night }) {
  return {
    island: fetchJson(`${DATA}island.json`),
    scene: fetchJson(`${DATA}scene.json`),
    night: night ? fetchJson(`${DATA}night.json`) : Promise.resolve({ blocks: [] }),
    pack: loadPack(),
  };
}

export async function loadImage(url) {
  const res = await fetch(versioned(url));
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const blob = await res.blob();
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

export async function loadTextures(names, pack = new Map()) {
  const entries = await Promise.all([...names].map(async (n) => [n, pack.get(n) ?? await loadImage(`${TEXTURE_BASE}${n}.png`)]));
  return new Map(entries);
}

// 16×16 tiles with edge pixels repeated into a padding, so mipmaps do not bleed between tiles.
export function buildAtlas(images, { size = 512, tile = 16, pad = 4 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const cell = tile + pad * 2;
  const cols = Math.floor(size / cell);
  const uv = new Map();
  let i = 0;
  for (const [name, img] of images) {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    if (y + cell > size) throw new Error('atlas is full');
    const s = tile, p = pad;
    const put = (sx, sy, sw, sh, dx, dy, dw, dh) => ctx.drawImage(img, sx, sy, sw, sh, x + dx, y + dy, dw, dh);
    put(0, 0, s, s, p, p, s, s);
    put(0, 0, 1, s, 0, p, p, s);
    put(s - 1, 0, 1, s, p + s, p, p, s);
    put(0, 0, s, 1, p, 0, s, p);
    put(0, s - 1, s, 1, p, p + s, s, p);
    put(0, 0, 1, 1, 0, 0, p, p);
    put(s - 1, 0, 1, 1, p + s, 0, p, p);
    put(0, s - 1, 1, 1, 0, p + s, p, p);
    put(s - 1, s - 1, 1, 1, p + s, p + s, p, p);
    uv.set(name, [(x + p) / size, (y + p) / size, (x + p + s) / size, (y + p + s) / size]);
    i++;
  }
  return {
    canvas,
    uvOf(name) {
      const r = uv.get(name);
      if (!r) throw new Error(`texture ${name} is not in the atlas`);
      return r;
    },
  };
}
