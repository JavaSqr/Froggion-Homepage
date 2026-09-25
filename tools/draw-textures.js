// Draws the site's own 16×16 textures (no game assets) into public/textures/,
// in the palette and style of the classic block textures.
// Each texture is a separate PNG, so an artist can replace any of them without touching code.
// Animated textures are vertical strips of 16×16 frames.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public/textures');

// ---------- tiny pixel toolkit ----------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const shade = (c, f) => [Math.max(0, Math.min(255, Math.round(c[0] * f))), Math.max(0, Math.min(255, Math.round(c[1] * f))), Math.max(0, Math.min(255, Math.round(c[2] * f))), c[3]];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const CLEAR = [0, 0, 0, 0];

class Tex {
  constructor(w = 16, h = 16) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h * 4);
  }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    this.d.set(c, (y * this.w + x) * 4);
  }
  get(x, y) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    return [...this.d.subarray((y * this.w + x) * 4, (y * this.w + x) * 4 + 4)];
  }
  each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, fn(x, y, this.get(x, y))); return this; }
  rect(x0, y0, w, h, c) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, typeof c === 'function' ? c(x, y) : c); return this; }
  blit(src, dx, dy) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const c = src.get(x, y); if (c[3]) this.set(dx + x, dy + y, c); } return this; }
  png() {
    const p = new PNG({ width: this.w, height: this.h });
    p.data.set(this.d);
    return PNG.sync.write(p, { colorType: 6 });
  }
}

// Pixel art from rows of characters; `.` or space is transparent.
function art(rows, palette) {
  const t = new Tex(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (palette[ch]) t.set(x, y, palette[ch]); }));
  return t;
}

// Smooth value noise, tileable on a 16 grid.
function valueNoise(seed, cell = 4, size = 16) {
  const r = rng(seed);
  const n = size / cell;
  const g = Array.from({ length: n * n }, () => r());
  const at = (i, j) => g[((j % n + n) % n) * n + ((i % n + n) % n)];
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// Picks from a dark→light palette using noise plus per-pixel jitter.
function speckle(seed, palette, { cell = 4, jitter = 0.35, bias = 0 } = {}) {
  const r = rng(seed + 7);
  const n = valueNoise(seed, cell);
  const t = new Tex();
  return t.each((x, y) => {
    const v = Math.max(0, Math.min(0.999, n(x, y) * (1 - jitter) + r() * jitter + bias));
    return palette[Math.floor(v * palette.length)];
  });
}

// Voronoi stones with dark mortar edges, used for cobblestone.
function stones(seed, count, base, mortar) {
  const r = rng(seed);
  const pts = Array.from({ length: count }, () => [r() * 16, r() * 16, 0.82 + r() * 0.3]);
  const t = new Tex();
  const dist = (x, y, p) => {
    let dx = Math.abs(x - p[0]), dy = Math.abs(y - p[1]);
    dx = Math.min(dx, 16 - dx); dy = Math.min(dy, 16 - dy);
    return Math.hypot(dx, dy * 1.15);
  };
  t.each((x, y) => {
    const d = pts.map((p, i) => [dist(x + 0.5, y + 0.5, p), i]).sort((a, b) => a[0] - b[0]);
    const edge = d[1][0] - d[0][0];
    const p = pts[d[0][1]];
    if (edge < 1.1) return shade(mortar, 0.9 + r() * 0.2);
    const top = (y + 0.5 - p[1] + 16) % 16 < 8 && y + 0.5 < p[1] ? 1.08 : 1;
    return shade(base, p[2] * top * (0.94 + r() * 0.12));
  });
  return t;
}

function outline(t, color) {
  const o = new Tex(t.w, t.h);
  o.blit(t, 0, 0);
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    if (t.get(x, y)[3]) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < t.w && ny < t.h && t.get(nx, ny)[3];
    });
    if (near) o.set(x, y, color);
  }
  return o;
}

function strip(frames) {
  const t = new Tex(16, 16 * frames.length);
  frames.forEach((f, i) => t.blit(f, 0, i * 16));
  return t;
}

// ---------- helpers for the classic look ----------

// Fine per-pixel grain: weighted picks from a small palette, like the game's block textures.
function grain(seed, entries, streaks = []) {
  const r = rng(seed);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  const t = new Tex().each(() => {
    let v = r() * total;
    for (const [c, w] of entries) if ((v -= w) < 0) return hex(c);
    return hex(entries[0][0]);
  });
  // [color, count, minLen, maxLen, vertical]
  for (const [color, count, minLen, maxLen, vertical] of streaks) {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      const len = minLen + Math.floor(r() * (maxLen - minLen + 1));
      for (let k = 0; k < len; k++) t.set(vertical ? x : (x + k) % 16, vertical ? (y + k) % 16 : y, hex(color));
    }
  }
  return t;
}

// Grayscale levels multiplied by a biome colour, like grass and leaves in the game.
const tint = (rgb, levels) => levels.map((l) => '#' + rgb.map((c) => Math.round(c * l).toString(16).padStart(2, '0')).join(''));
const GRASS_TINT = [145, 189, 89];
const FOLIAGE_TINT = [119, 171, 47];
const WATER_TINT = [63, 118, 228];

const GRASS_TOP = tint(GRASS_TINT, [0.6, 0.66, 0.72, 0.78, 0.85]);
const DIRT_E = [['#866043', 8], ['#79553a', 5], ['#976d4d', 4], ['#6c4b33', 2.5], ['#5d4129', 1]];
const STONE_E = [['#7f7f7f', 10], ['#767676', 4], ['#878787', 4], ['#6d6d6d', 1.3], ['#8f8f8f', 1]];
const MOSS = ['#5b7a36', '#4c6b2a', '#6c8a40'];

// Rounded stones with dark mortar, lit from the top left.
function cobble(seed, faces, mortar, count = 15) {
  const r = rng(seed);
  const pts = Array.from({ length: count }, () => [r() * 16, r() * 16, Math.floor(r() * faces.length)]);
  const dist = (x, y, p) => {
    let dx = Math.abs(x - p[0]), dy = Math.abs(y - p[1]);
    dx = Math.min(dx, 16 - dx); dy = Math.min(dy, 16 - dy);
    return Math.hypot(dx, dy);
  };
  const cellOf = (x, y) => pts.map((p, i) => [dist(x + 0.5, y + 0.5, p), i]).sort((a, b) => a[0] - b[0]);
  return new Tex().each((x, y) => {
    const d = cellOf(x, y);
    if (d[1][0] - d[0][0] < 0.9) return hex(r() < 0.5 ? mortar[0] : mortar[1]);
    const up = cellOf(x, (y + 15) % 16)[0][1] !== d[0][1];
    const left = cellOf((x + 15) % 16, y)[0][1] !== d[0][1];
    const down = cellOf(x, (y + 1) % 16)[0][1] !== d[0][1];
    let c = faces[pts[d[0][1]][2]];
    if (up || left) c = faces[Math.max(0, pts[d[0][1]][2] - 1)];
    if (down) c = faces[Math.min(faces.length - 1, pts[d[0][1]][2] + 1)];
    return r() < 0.12 ? shade(hex(c), 0.93) : hex(c);
  });
}

function bricks(seed, mossy) {
  const r = rng(seed), n = valueNoise(seed + 1, 8);
  const face = ['#7b7b7b', '#747474', '#818181'];
  return new Tex().each((x, y) => {
    const row = Math.floor(y / 8);
    const seam = row === 0 ? 15 : 7;
    const yy = y % 8;
    if (yy === 7 || x === seam) return hex(r() < 0.6 ? '#5a5a5a' : '#535353');
    let c = hex(face[Math.floor(r() * face.length)]);
    if (yy === 0) c = hex('#8b8b8b');
    else if (yy === 6) c = hex('#686868');
    else if (x === (seam + 1) % 16) c = hex('#848484');
    if (mossy && n(x, y) * 0.8 + r() * 0.3 > 0.72) c = hex(MOSS[Math.floor(r() * MOSS.length)]);
    return c;
  });
}

function planks(seed, colors, seamColor) {
  const r = rng(seed);
  const seams = [3, 11, 7, 13];
  return new Tex().each((x, y) => {
    const row = Math.floor(y / 4);
    if (y % 4 === 3) return hex(seamColor);
    if (x === seams[row]) return shade(hex(seamColor), 1.08);
    const c = hex(colors[Math.floor(r() * colors.length)]);
    return (x + row * 5) % 7 === 0 && r() < 0.6 ? shade(c, 0.94) : c;
  });
}

// ---------- blocks ----------

const T = {};

T['block/stone'] = () => grain(11, STONE_E, [['#686868', 8, 2, 4], ['#8e8e8e', 5, 2, 3]]);
T['block/andesite'] = () => {
  const n = valueNoise(12, 4), r = rng(13);
  const pal = ['#7c7c7c', '#848484', '#8a8a8a', '#939393', '#9c9c9c'];
  return new Tex().each((x, y) => hex(pal[Math.min(4, Math.floor((n(x, y) * 0.7 + r() * 0.3) * 5))]));
};
T['block/cobblestone'] = () => cobble(21, ['#a3a3a3', '#8f8f8f', '#808080', '#727272', '#666666'], ['#4f4f4f', '#5a5a5a']);
T['block/mossy_cobblestone'] = () => {
  const t = cobble(21, ['#a3a3a3', '#8f8f8f', '#808080', '#727272', '#666666'], ['#4f4f4f', '#5a5a5a']);
  const n = valueNoise(22, 8), r = rng(23);
  return t.each((x, y, c) => (n(x, y) * 0.8 + r() * 0.3 > 0.68 ? hex(MOSS[Math.floor(r() * MOSS.length)]) : c));
};
T['block/stone_bricks'] = () => bricks(31, false);
T['block/mossy_stone_bricks'] = () => bricks(31, true);
T['block/dirt'] = () => grain(41, DIRT_E, [['#b9855c', 4, 1, 1], ['#4d3524', 5, 1, 2]]);
T['block/grass_block_top'] = () => grain(51, GRASS_TOP.map((c, i) => [c, [3, 5, 6, 4, 2][i]]), [[GRASS_TOP[0], 6, 1, 2], [GRASS_TOP[4], 4, 1, 1]]);
T['block/grass_block_side'] = () => {
  const t = grain(41, DIRT_E, [['#b9855c', 4, 1, 1], ['#4d3524', 5, 1, 2]]);
  const r = rng(52);
  const g = GRASS_TOP.map((c) => shade(hex(c), 0.95));
  for (let x = 0; x < 16; x++) {
    const depth = 3 + (r() < 0.55 ? 1 : 0) + (r() < 0.2 ? 1 : 0);
    for (let y = 0; y < depth; y++) t.set(x, y, g[Math.floor(r() * g.length)]);
  }
  return t;
};
T['block/sand'] = () => grain(61, [['#dbd3a0', 8], ['#d4cc96', 5], ['#e2dab0', 4], ['#cdc38c', 2.5]], [['#c2b47d', 5, 1, 1], ['#e8e1bb', 3, 1, 1]]);
const PATH_E = [['#94793f', 6], ['#8a6f3a', 5], ['#9e8550', 4], ['#7e6536', 2]];
T['block/grass_path_top'] = () => grain(71, PATH_E, [['#a88f59', 5, 2, 3], ['#735b30', 4, 1, 2]]);
T['block/grass_path_side'] = () => {
  const t = grain(41, DIRT_E, [['#b9855c', 4, 1, 1], ['#4d3524', 5, 1, 2]]);
  const top = grain(72, PATH_E);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) t.set(x, y, top.get(x, y));
  return t;
};
T['block/farmland_moist'] = () => {
  const t = grain(81, [['#4f3219', 6], ['#5b3a1f', 4], ['#442a14', 3], ['#63411f', 1.5]]);
  return t.each((x, y, c) => (y % 4 === 1 ? shade(c, 0.7) : y % 4 === 3 && x % 5 === 0 ? shade(c, 1.15) : c));
};
T['block/emerald_ore'] = () => {
  const t = grain(11, STONE_E, [['#686868', 8, 2, 4], ['#8e8e8e', 5, 2, 3]]);
  const dark = hex('#0b6a30'), mid = hex('#0f9e47'), light = hex('#17dd62'), hi = hex('#a6fcc6');
  for (const [cx, cy] of [[3, 2], [10, 4], [5, 10], [12, 11]]) {
    t.set(cx, cy, mid); t.set(cx + 1, cy, light); t.set(cx, cy + 1, light); t.set(cx + 1, cy + 1, mid);
    t.set(cx + 1, cy - 1, dark); t.set(cx - 1, cy + 1, dark); t.set(cx + 2, cy + 1, dark); t.set(cx, cy + 2, dark);
    t.set(cx + 1, cy, hi);
  }
  return t;
};
T['block/oak_log'] = () => {
  const r = rng(91);
  const cols = Array.from({ length: 16 }, (_, x) => (x % 3 === 0 ? '#4e3d24' : r() < 0.5 ? '#6d5532' : '#654e2e'));
  return new Tex().each((x, y) => {
    let c = hex(cols[x]);
    if (r() < 0.1) c = hex('#7e6440');
    if (x % 3 !== 0 && r() < 0.06) c = hex('#4e3d24');
    return c;
  });
};
T['block/oak_log_top'] = () => {
  const r = rng(92);
  return new Tex().each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.6) return hex(r() < 0.5 ? '#6d5532' : '#5d472a');
    const ring = Math.floor(d) % 2;
    return hex(ring ? '#a17d49' : '#b8945f');
  });
};
T['block/oak_leaves'] = () => {
  const r = rng(101);
  const pal = tint(FOLIAGE_TINT, [0.42, 0.5, 0.58, 0.66, 0.74]);
  return new Tex().each(() => {
    const v = r();
    if (v < 0.18) return CLEAR;
    return hex(pal[Math.floor(r() * pal.length)]);
  });
};
T['block/glass'] = () => {
  const t = new Tex();
  const edge = hex('#dbeef3'), edge2 = hex('#b5d3dc');
  for (let i = 0; i < 16; i++) { t.set(i, 0, edge); t.set(0, i, edge); t.set(i, 15, edge2); t.set(15, i, edge2); }
  for (const [x, y] of [[2, 3], [3, 2], [3, 4], [4, 3], [4, 5], [5, 4]]) t.set(x, y, hex('#e9f7fb'));
  return t;
};
T['block/birch_planks'] = () => planks(111, ['#c5b57c', '#bfae74', '#cdbf86'], '#9f8f5b');
T['block/crimson_planks'] = () => planks(112, ['#6a3349', '#723851', '#62304a'], '#4b2233');
T['block/warped_trapdoor'] = () => {
  const t = planks(113, ['#2f7b73', '#35857c', '#2b716a'], '#1f514c');
  const frame = hex('#1d4c47');
  for (let i = 0; i < 16; i++) { t.set(i, 0, frame); t.set(i, 15, frame); t.set(0, i, frame); t.set(15, i, frame); }
  for (const [x, y] of [[4, 4], [5, 4], [10, 4], [11, 4], [4, 5], [11, 5], [4, 10], [4, 11], [11, 10], [11, 11], [5, 11], [10, 11]]) t.set(x, y, CLEAR);
  return t;
};

// Water: the tinted grayscale ripples of the game, translucent. Flow: the same, streaming down.
function waterFrame(i, n, flow) {
  const levels = [0.62, 0.68, 0.74, 0.8, 0.88];
  const base = tint(WATER_TINT, levels).map((c) => hex(c, 175));
  const noise = valueNoise(201 + (flow ? 3 : 0), 4);
  const phase = i / n;
  return new Tex().each((x, y) => {
    const yy = flow ? y - phase * 16 : y;
    const v = flow
      ? noise(x, yy) * 0.6 + 0.4 * (0.5 + 0.5 * Math.sin((yy / 16) * Math.PI * 4 + x * 0.9))
      : noise(x + Math.sin(phase * Math.PI * 2) * 2, y + phase * 16) * 0.6 + 0.4 * (0.5 + 0.5 * Math.sin((x - y) * 0.6 + phase * Math.PI * 2));
    return base[Math.max(0, Math.min(base.length - 1, Math.floor(v * base.length)))];
  });
}
T['block/water_still'] = () => strip(Array.from({ length: 16 }, (_, i) => waterFrame(i, 16, false)));
T['block/water_flow'] = () => strip(Array.from({ length: 16 }, (_, i) => waterFrame(i, 16, true)));
T['block/lava_still'] = () => strip(Array.from({ length: 16 }, (_, i) => {
  const base = ['#b8410c', '#cf5a12', '#e0741c', '#ee9227', '#f8b23c', '#ffd064'].map((h) => hex(h));
  const n1 = valueNoise(301, 8), n2 = valueNoise(302, 4);
  const ph = (i / 16) * Math.PI * 2;
  return new Tex().each((x, y) => {
    const v = n1(x + Math.cos(ph) * 3, y + Math.sin(ph) * 3) * 0.6 + n2(x - i, y + i * 0.5) * 0.4;
    return base[Math.max(0, Math.min(base.length - 1, Math.floor(v * base.length * 1.05)))];
  });
}));

// Lava sides: the same molten colours streaming down, one pixel per frame.
T['block/lava_flow'] = () => strip(Array.from({ length: 16 }, (_, i) => {
  const base = ['#b8410c', '#cf5a12', '#e0741c', '#ee9227', '#f8b23c', '#ffd064'].map((h) => hex(h));
  const n1 = valueNoise(303, 4), n2 = valueNoise(304, 8);
  return new Tex().each((x, y) => {
    const yy = y - i;
    const v = n1(x, yy) * 0.5 + n2(x, yy) * 0.2 + 0.3 * (0.5 + 0.5 * Math.sin(x * 1.25 + n2(x, yy) * 5));
    return base[Math.max(0, Math.min(base.length - 1, Math.floor(v * base.length * 1.05)))];
  });
}));

// Crops: sprouts that grow into golden wheat with dark heads.
for (let stage = 0; stage < 8; stage++) {
  T[`block/wheat_stage${stage}`] = () => {
    const r = rng(400 + stage);
    const t = new Tex();
    const ripe = Math.max(0, (stage - 3) / 4);
    const green = ['#2f7a1a', '#3c8d22', '#4d9f2c'].map((h) => hex(h));
    const gold = ['#9c7d2e', '#b89646', '#d0b05a'].map((h) => hex(h));
    const height = 2 + Math.round(stage * 1.8);
    for (const x0 of [1, 3, 5, 7, 9, 11, 13, 14]) {
      const h = Math.max(1, height - Math.floor(r() * 3));
      let x = x0;
      for (let k = 0; k < h; k++) {
        const c = mix(green[Math.floor(r() * 3)], gold[Math.floor(r() * 3)], Math.min(1, ripe * (0.5 + k / h)));
        t.set(x, 15 - k, c);
        if (k > 2 && r() < 0.16) x += r() < 0.5 ? -1 : 1;
      }
      if (stage >= 5) {
        const top = 15 - h;
        const head = stage === 7 ? ['#8a6d25', '#a5873a'] : ['#7c8f2d', '#94a23a'];
        for (let k = 0; k < stage - 2; k++) {
          t.set(x, top + 1 + k, hex(head[k % 2]));
          if (k % 2 === 0) t.set(x - 1, top + 1 + k, shade(hex(head[0]), 0.85));
        }
      }
    }
    return t;
  };
}

function tuft(seed, pal, blades, minH, maxH) {
  const r = rng(seed);
  const t = new Tex();
  for (let i = 0; i < blades; i++) {
    let x = 1 + Math.floor(r() * 14);
    const h = minH + Math.floor(r() * (maxH - minH));
    for (let k = 0; k < h; k++) {
      t.set(x, 15 - k, hex(pal[Math.min(pal.length - 1, Math.floor((k / h) * pal.length + r() * 0.8))]));
      if (k > 3 && r() < 0.22) x += r() < 0.5 ? -1 : 1;
    }
  }
  return t;
}
T['block/grass'] = () => tuft(501, tint(GRASS_TINT, [0.5, 0.58, 0.66, 0.74, 0.82]), 11, 5, 14);
T['block/fern'] = () => {
  const r = rng(502);
  const t = new Tex();
  const c = tint(GRASS_TINT, [0.45, 0.55, 0.65]).map((h) => hex(h));
  for (const [bx, dir] of [[7, -1], [8, 1], [7, 0], [5, -1], [10, 1]]) {
    let x = bx;
    for (let k = 0; k < 13; k++) {
      const y = 15 - k;
      t.set(x, y, c[1]);
      if (k % 2 === 1 && k < 11) { t.set(x - 1, y, c[Math.floor(r() * 3)]); t.set(x + 1, y, c[Math.floor(r() * 3)]); }
      if (k % 4 === 3) x += dir;
    }
  }
  return t;
};
T['block/orange_tulip'] = () => art([
  '................',
  '................',
  '......o..o......',
  '.....oOooOo.....',
  '.....oOOOOo.....',
  '.....oOyOOo.....',
  '......oOOo......',
  '.......gg.......',
  '.......g........',
  '...l...g...l....',
  '...ll..g..ll....',
  '....ll.g.ll.....',
  '.....llgll......',
  '......lgl.......',
  '.......g........',
  '.......g........',
], { o: hex('#c9531a'), O: hex('#e5681b'), y: hex('#f4a04a'), g: hex('#3f7a24'), l: hex('#4f8a2d') });

// Destroy stages: cracks spreading from the centre.
for (let s = 0; s < 10; s++) {
  T[`block/destroy_stage_${s}`] = () => {
    const r = rng(600);
    const t = new Tex();
    const dark = [16, 16, 16, 150], mid = [30, 30, 30, 105];
    for (let b = 0; b < 9; b++) {
      const ang = (b / 9) * Math.PI * 2 + r() * 0.7;
      const len = 0.6 + s * 0.95 * (0.7 + r() * 0.5);
      let x = 7.5 + (r() - 0.5) * 2, y = 7.5 + (r() - 0.5) * 2;
      for (let k = 0; k < len; k++) {
        x += Math.cos(ang) + (r() - 0.5) * 0.8;
        y += Math.sin(ang) + (r() - 0.5) * 0.8;
        t.set(x, y, k < len * 0.7 ? dark : mid);
      }
    }
    return t;
  };
}

// Night lights. Lantern texture layout (pixels): body sides 0..6 × 0..7, body top/bottom 0..6 × 9..15,
// cap sides 7..11 × 0..2, cap top 7..11 × 3..7, chain 13..15 × 0..6.
T['block/lantern'] = () => {
  const t = new Tex();
  const iron = hex('#26262b'), iron2 = hex('#3a3a42'), rim = hex('#4d4d57');
  // Sides (6×7): iron rims top and bottom, bars at the edges, a flame behind the glass.
  const pane = [
    'KHHHHK',
    'KodddK',
    'KdyydK',
    'KywwyK',
    'KywwyK',
    'KoyyoK',
    'KHHHHK',
  ];
  const c = { K: iron, H: rim, o: hex('#b8561a'), d: hex('#e0822a'), y: hex('#ffc24a'), w: hex('#fff2c0') };
  pane.forEach((row, y) => [...row].forEach((k, x) => t.set(x, y, c[k])));
  // Top and bottom plates (6×6).
  for (let y = 9; y < 15; y++) for (let x = 0; x < 6; x++) t.set(x, y, x === 0 || x === 5 || y === 9 || y === 14 ? iron : (x + y) % 2 ? iron2 : rim);
  // Cap and chain.
  for (let x = 7; x < 11; x++) { t.set(x, 0, rim); t.set(x, 1, iron); }
  for (let y = 3; y < 7; y++) for (let x = 7; x < 11; x++) t.set(x, y, (x + y) % 3 === 0 ? rim : iron2);
  for (let y = 0; y < 6; y++) { t.set(13, y, y % 2 ? iron : rim); t.set(14, y, y % 2 ? rim : iron); }
  return t;
};
// Torch: stick in columns 7..8, flame on top (rows 6..8), vanilla-style UV rows.
T['block/torch'] = () => {
  const t = new Tex();
  const wood = [hex('#5a4220'), hex('#7a5a2c'), hex('#8e6c38')];
  for (let y = 8; y < 16; y++) { t.set(7, y, wood[(y + 1) % 3]); t.set(8, y, wood[y % 3]); }
  t.set(7, 6, hex('#fff6c8')); t.set(8, 6, hex('#ffd35a'));
  t.set(7, 7, hex('#ffb53a')); t.set(8, 7, hex('#ff8f22'));
  t.set(7, 13, hex('#4a361b')); t.set(8, 13, hex('#4a361b')); t.set(7, 14, hex('#4a361b')); t.set(8, 14, hex('#4a361b'));
  return t;
};
T['environment/moon'] = () => {
  const t = new Tex(32, 32);
  const r = rng(801);
  const base = ['#d9dde6', '#cfd4de', '#e3e7ee'].map((h) => hex(h));
  const crater = ['#aab2c2', '#b8bfcc'].map((h) => hex(h));
  t.rect(6, 6, 20, 20, () => base[Math.floor(r() * base.length)]);
  for (const [cx, cy, w, h] of [[9, 9, 4, 3], [17, 12, 5, 4], [11, 18, 3, 3], [20, 20, 3, 2], [14, 8, 2, 2], [8, 22, 2, 2]]) t.rect(cx, cy, w, h, () => crater[Math.floor(r() * 2)]);
  return t;
};
T['particle/flame'] = () => art([
  '........', '...y....', '..yYy...', '..YWYy..', '.yYWWYy.', '.oYYYYo.', '..oooo..', '........',
], { y: hex('#ffd35a'), Y: hex('#ffb53a'), W: hex('#fff6c8'), o: hex('#ff7a1a') });
T['particle/lava'] = () => art([
  '........', '........', '...oo...', '..oYYo..', '..oYYo..', '...oo...', '........', '........',
], { o: hex('#e0541a'), Y: hex('#ffc04a') });
T['particle/glow'] = () => {
  const t = new Tex(32, 32);
  return t.each((x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5) / 15.5;
    const a = Math.max(0, 1 - d);
    return [255, 255, 255, Math.round(255 * a ** 1.5)];
  });
};

// ---------- items ----------

const ITEM_OUTLINE = hex('#1d1d22');
T['item/diamond_pickaxe'] = () => art([
  '................',
  '....DDDDD.......',
  '...DddddddD.....',
  '....DDDDddDD....',
  '........DWddD...',
  '.......W..DdD...',
  '......W....DdD..',
  '.....W.....DdD..',
  '....W.......DdD.',
  '...W........DD..',
  '..W.............',
  '.W..............',
  'W...............',
  '................',
  '................',
  '................',
], { D: hex('#127a73'), d: hex('#3fd6c2'), W: hex('#6b4f25') });
T['item/diamond_sword'] = () => art([
  '................',
  '.............DD.',
  '............DdD.',
  '...........DdD..',
  '..........DdD...',
  '.........DdD....',
  '........DdD.....',
  '.......DdD......',
  '..G...DdD.......',
  '..GG.DdD........',
  '...GGdD.........',
  '....GG..........',
  '...WWGG.........',
  '..WW..G.........',
  '.PP.............',
  '................',
], { D: hex('#127a73'), d: hex('#4fe0cc'), G: hex('#3d2e17'), W: hex('#6b4f25'), P: hex('#1f5a55') });
const ROD = [
  '................',
  '..............WL',
  '.............W.L',
  '............W..L',
  '...........W...L',
  '..........W....L',
  '.........W.....L',
  '........W......L',
  '.......W.......L',
  '......W........L',
  '.....W.........L',
  '....W..........L',
  '...W...........L',
  '..W...........LL',
  '.W............H.',
  'W...............',
];
T['item/fishing_rod'] = () => art(ROD, { W: hex('#6b4b2a'), L: hex('#d6d6d6'), H: hex('#9a9aa0') });
T['item/fishing_rod_cast'] = () => art(ROD.map((r) => r.replace(/[LH]/g, '.')), { W: hex('#6b4b2a') });
T['item/wheat_seeds'] = () => art([
  '................', '................', '................', '................',
  '......s.........', '.....sS...s.....', '.....S...sS.....', '..........S.....',
  '...s.....s......', '...sS...sS......', '....S....S..s...', '............sS..',
  '.......s.....S..', '......sS........', '.......S........', '................',
], { s: hex('#5b8f2a'), S: hex('#3c6a1a') });
T['item/cod'] = () => outline(art([
  '................', '................', '................', '................',
  '................', '...........t....', '...bbbbbbb.tt...', '..bwbbbbbbbttt..',
  '..bbbbbbbbbttt..', '...ccccccc.tt...', '...........t....', '................',
  '................', '................', '................', '................',
], { b: hex('#b39a73'), c: hex('#d8c7a4'), w: hex('#1e1e1e'), t: hex('#8f7856') }), ITEM_OUTLINE);
T['item/pufferfish'] = () => outline(art([
  '................', '................', '................', '.....s..s.......',
  '....yyyyyy......', '..syyyyyyyys....', '...yywyyyyyyf....', '..syyyyyyyyyff...',
  '...yyyyyyyyyf....', '..sooyyyyyys.....', '....oooooo......', '.....s..s.......',
  '................', '................', '................', '................',
].map((r) => r.slice(0, 16)), { y: hex('#f2c230'), o: hex('#d99a22'), w: hex('#1e1e1e'), s: hex('#e8e0c0'), f: hex('#6fa7c9') }), ITEM_OUTLINE);
T['item/bowl'] = () => outline(art([
  '................', '................', '................', '................',
  '................', '................', '..bbbbbbbbbbbb..', '..BddddddddddB..',
  '...BbbbbbbbbB...', '....BbbbbbbB....', '.....BBBBBB.....', '................',
  '................', '................', '................', '................',
], { b: hex('#8a5f32'), B: hex('#6a4524'), d: hex('#3f2814') }), ITEM_OUTLINE);
T['item/rotten_flesh'] = () => outline(art([
  '................', '................', '................', '.....rr.........',
  '....rRRr..g.....', '...rRRRRrr......', '..rRgRRRRRr.....', '..rRRRRgRRRr....',
  '...rRRRRRRRr....', '....rrRRgRr.....', '......rRRr......', '.......rr.......',
  '................', '................', '................', '................',
], { r: hex('#7a2f22'), R: hex('#a8483a'), g: hex('#5f7f35') }), ITEM_OUTLINE);

// ---------- entities ----------

T['entity/fishing_bobber'] = () => art([
  '...ww...', '..wwww..', '..RRRR..', '.RRRRRR.', '.RRRRRR.', '..RRRR..', '...dd...', '...d....',
], { w: hex('#f2f2f2'), R: hex('#c8322a'), d: hex('#3a3a3a') });
T['entity/experience_orb'] = () => art([
  '................', '................', '................', '.....gggggg.....',
  '....gyyyyyyg....', '...gyYYYYYYyg...', '...gyYWWYYYyg...', '...gyYWYYYYyg...',
  '...gyYYYYYYyg...', '...gyYYYYYYyg...', '....gyyyyyyg....', '.....gggggg.....',
  '................', '................', '................', '................',
], { g: hex('#3f8f1f'), y: hex('#8fd43a'), Y: hex('#d8f25a'), W: hex('#ffffc8') });

// Creeper, 64×32, laid out like the game's box UVs (head 0,0; body 16,16; legs 0,16).
T['entity/creeper'] = () => {
  const t = new Tex(64, 32);
  const camo = ['#2b5e22', '#3a7d2f', '#4d9e3e', '#5aab48', '#6ab957', '#9fcf92'].map((h) => hex(h));
  const n = valueNoise(701, 4, 64), r = rng(702);
  t.each((x, y) => {
    const v = n(x, y) * 0.55 + r() * 0.45;
    return camo[Math.min(camo.length - 1, Math.floor(v * camo.length))];
  });
  // Clear unused areas so the file reads like a skin layout.
  t.rect(0, 0, 8, 8, CLEAR); t.rect(32, 0, 32, 16, CLEAR); t.rect(0, 16, 4, 4, CLEAR); t.rect(12, 16, 8, 4, CLEAR);
  t.rect(36, 16, 4, 4, CLEAR); t.rect(40, 16, 24, 16, CLEAR); t.rect(0, 26, 16, 6, CLEAR);
  // Face on the head front (8..16, 8..16): hollow eyes and a drooping mouth.
  const face = hex('#101410'), faceDim = hex('#1d2a1a');
  const f = (x, y, c = face) => t.set(8 + x, 8 + y, c);
  [[1, 2], [2, 2], [1, 3], [2, 3], [5, 2], [6, 2], [5, 3], [6, 3]].forEach(([x, y]) => f(x, y));
  [[3, 4], [4, 4], [3, 5], [4, 5], [2, 5], [5, 5], [2, 6], [5, 6], [3, 6], [4, 6], [2, 7], [5, 7]].forEach(([x, y]) => f(x, y));
  [[1, 4], [6, 4]].forEach(([x, y]) => f(x, y, faceDim));
  return t;
};

// ---------- particles ----------

for (let i = 0; i < 8; i++) {
  T[`particle/generic_${i}`] = () => {
    const t = new Tex(8, 8);
    const rad = 3.6 - i * 0.42;
    return t.each((x, y) => {
      const d = Math.hypot(x - 3.5, y - 3.5);
      if (d > rad) return CLEAR;
      return d > rad - 1 ? [200, 200, 200, 255] : [255, 255, 255, 255];
    });
  };
}
for (let i = 0; i < 4; i++) {
  T[`particle/splash_${i}`] = () => {
    const t = new Tex(8, 8);
    const pts = [[[3, 3], [4, 3], [3, 4], [4, 4]], [[3, 2], [3, 3], [4, 4], [4, 5]], [[3, 4], [4, 4]], [[4, 4]]][i];
    for (const [x, y] of pts) t.set(x, y, [255, 255, 255, 255]);
    return t;
  };
}
T['particle/bubble'] = () => art([
  '........', '..wwww..', '.w....w.', '.w.h..w.', '.w....w.', '.w....w.', '..wwww..', '........',
], { w: [255, 255, 255, 255], h: [255, 255, 255, 200] });
for (let i = 0; i < 4; i++) {
  T[`particle/fishing_${i}`] = () => {
    const t = new Tex(8, 8);
    const s = 3 - i;
    t.rect(4 - Math.ceil(s / 2), 4 - Math.ceil(s / 2), Math.max(1, s), Math.max(1, s), [255, 255, 255, 255]);
    return t;
  };
}
for (let i = 0; i < 8; i++) {
  T[`particle/sweep_${i}`] = () => {
    const t = new Tex(32, 16);
    const a0 = Math.PI * (1.05 + i * 0.05), a1 = Math.PI * (1.95 - i * 0.02);
    for (let a = a0; a <= a1; a += 0.01) {
      for (let w = 0; w < 3 - Math.floor(i / 3); w++) {
        const rr = 13 - w - i * 0.3;
        const x = 16 + Math.cos(a) * rr, y = 15 + Math.sin(a) * rr * 0.9;
        const fade = 1 - Math.abs((a - a0) / (a1 - a0) - 0.5) * 1.4;
        t.set(x, y, [255, 255, 255, Math.round(255 * Math.max(0.25, fade))]);
      }
    }
    return t;
  };
}
T['particle/damage'] = () => art([
  '........', '.hh.hh..', 'hHHhHHh.', 'hHHHHHh.', '.hHHHh..', '..hHh...', '...h....', '........',
], { h: hex('#2a0c0c'), H: hex('#5a1a1a') });

// ---------- write ----------

// Existing files are kept (they may be an artist's replacements); --force redraws everything.
const force = process.argv.includes('--force');
let n = 0, bytes = 0;
for (const [name, draw] of Object.entries(T)) {
  const file = path.join(OUT, `${name}.png`);
  if (!force && fs.existsSync(file)) continue;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const png = draw().png();
  fs.writeFileSync(file, png);
  n++; bytes += png.length;
}
console.log(`${n} textures written, ${(bytes / 1024).toFixed(1)} KB${force ? '' : ' (existing files kept; --force to redraw)'}`);
