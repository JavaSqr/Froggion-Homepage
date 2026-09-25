// Island mesher: hidden-face culling, per-face shading like the game, corner ambient occlusion,
// partial blocks, plants, glass and fluids. Pure JS, no three.js, so it runs in tests too.
import { modelFor, plantOffset } from './blocks.js';

export const SHADE = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };
const AO_LEVELS = [0.55, 0.7, 0.85, 1];
const FLUID_SOURCE_HEIGHT = 8 / 9;

const DIRS = {
  up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
};

// Face corners TL, TR, BR, BL as seen from outside, in 0..1 cell units from a box [x0..x1]×[y0..y1]×[z0..z1].
function corners(face, [x0, y0, z0], [x1, y1, z1]) {
  switch (face) {
    case 'north': return [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]];
    case 'south': return [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]];
    case 'west': return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]];
    case 'east': return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]];
    case 'up': return [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    default: return [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]];
  }
}

// Default face UVs of a model element (pixels, v from the top), like vanilla block models.
function faceUV(face, f, t) {
  switch (face) {
    case 'down': return [f[0], 16 - t[2], t[0], 16 - f[2]];
    case 'up': return [f[0], f[2], t[0], t[2]];
    case 'north': return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
    case 'south': return [f[0], 16 - t[1], t[0], 16 - f[1]];
    case 'west': return [f[2], 16 - t[1], t[2], 16 - f[1]];
    default: return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
  }
}

class Buffer {
  constructor() { this.pos = []; this.uv = []; this.color = []; this.index = []; this.count = 0; }
  quad(v, uv, shade, alpha = [1, 1, 1, 1]) {
    const n = this.count;
    for (let i = 0; i < 4; i++) {
      this.pos.push(v[i][0], v[i][1], v[i][2]);
      this.uv.push(uv[i][0], uv[i][1]);
      const s = shade[i] * (this.sink ? this.sink(v[i][1]) : 1);
      this.color.push(s, s, s, alpha[i]);
    }
    this.index.push(n, n + 3, n + 2, n, n + 2, n + 1);
    this.count += 4;
  }
  toArrays() {
    return { position: new Float32Array(this.pos), uv: new Float32Array(this.uv), color: new Float32Array(this.color), index: new Uint32Array(this.index), quads: this.count / 4 };
  }
}

/**
 * grid: { size: [sx, sy, sz], get(x, y, z) → palette index } in island-local coordinates.
 * palette: state strings. uvOf(texture) → [u0, v0, u1, v1] in atlas space (v0 = top edge).
 * skip(x, y, z) → true for cells rendered separately (dynamic blocks); they count as air here.
 * fade: optional { y0, y1 } fading fluid alpha from 0 at y0 to 1 at y1 (the waterfall's bottom).
 */
// depthFade: { y0, y1, min } darkens everything below y1 towards `min` at y0, so the rock underside sinks into the dark.
export function createMesher({ palette, uvOf, fade = null, depthFade = null }) {
  const sink = (y) => {
    if (!depthFade) return 1;
    const t = Math.max(0, Math.min(1, (y - depthFade.y0) / (depthFade.y1 - depthFade.y0)));
    return depthFade.min + (1 - depthFade.min) * t * t * (3 - 2 * t);
  };
  const models = palette.map((s) => modelFor(s));
  const isWater = (m) => (m.kind === 'fluid' && m.fluid === 'water') || m.water;
  const isLava = (m) => m.kind === 'fluid' && m.fluid === 'lava';

  function build(grid, { cells = null, skip = () => false } = {}) {
    const out = { solid: new Buffer(), cutout: new Buffer(), waterStill: new Buffer(), waterFlow: new Buffer(), lava: new Buffer() };
    for (const b of Object.values(out)) b.sink = sink;
    const [sx, sy, sz] = grid.size;
    const model = (x, y, z) => (skip(x, y, z) ? models[0] : models[grid.get(x, y, z)] ?? models[0]);
    const opaque = (x, y, z) => !!model(x, y, z).opaque;

    // Corner AO from the three cells around each vertex in the layer the face looks into.
    function ao(face, cx, cy, cz, corner, inside) {
      const d = DIRS[face];
      const lx = inside ? cx : cx + d[0], ly = inside ? cy : cy + d[1], lz = inside ? cz : cz + d[2];
      const axes = [0, 1, 2].filter((a) => d[a] === 0);
      const s = axes.map((a) => (corner[a] > 0.5 ? 1 : -1));
      const at = (a0, a1) => {
        const p = [lx, ly, lz];
        p[axes[0]] += a0; p[axes[1]] += a1;
        return opaque(p[0], p[1], p[2]) ? 1 : 0;
      };
      const s1 = at(s[0], 0), s2 = at(0, s[1]), c = at(s[0], s[1]);
      return AO_LEVELS[s1 && s2 ? 0 : 3 - (s1 + s2 + c)];
    }

    function addBox(buf, x, y, z, from, to, tex, cullFn) {
      const f = from.map((v) => v / 16), t = to.map((v) => v / 16);
      for (const face of Object.keys(DIRS)) {
        const d = DIRS[face];
        // Distance from the face to the cell boundary it points at.
        const gap = d[0] === -1 ? f[0] : d[0] === 1 ? 1 - t[0] : d[1] === -1 ? f[1] : d[1] === 1 ? 1 - t[1] : d[2] === -1 ? f[2] : 1 - t[2];
        const onEdge = gap === 0;
        if (onEdge && cullFn(x + d[0], y + d[1], z + d[2])) continue;
        const cs = corners(face, f, t);
        const [u0, v0, u1, v1] = faceUV(face, from, to);
        const [au0, av0, au1, av1] = uvOf(tex[face]);
        const U = (u) => au0 + (au1 - au0) * (u / 16), V = (v) => av0 + (av1 - av0) * (v / 16);
        const uv = [[U(u0), V(v0)], [U(u1), V(v0)], [U(u1), V(v1)], [U(u0), V(v1)]];
        const shade = cs.map((c) => SHADE[face] * ao(face, x, y, z, c, gap > 0.125));
        buf.quad(cs.map((c) => [x + c[0], y + c[1], z + c[2]]), uv, shade);
      }
    }

    function addPlane(buf, x, y, z, a, b, y0, y1, tex) {
      const [u0, v0, u1, v1] = uvOf(tex);
      const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      const quad = [[a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]], [a[0], y0, a[1]]].map((c) => [x + c[0], y + c[1], z + c[2]]);
      buf.quad(quad, uv, [1, 1, 1, 1]);
    }

    function fluidHeight(m, above) {
      if (!m) return 0;
      if (above) return 1;
      const level = m.kind === 'fluid' ? m.level : 0;
      if (level >= 8) return FLUID_SOURCE_HEIGHT;
      return level === 0 ? FLUID_SOURCE_HEIGHT : (8 - level) / 9;
    }

    function addFluid(x, y, z, m) {
      const water = isWater(m);
      const same = water ? isWater : isLava;
      const above = same(model(x, y + 1, z));
      const h = fluidHeight(m.kind === 'fluid' ? m : { kind: 'fluid', level: 0 }, above);
      const alphaAt = (yy) => (fade && water ? Math.max(0, Math.min(1, (yy - fade.y0) / (fade.y1 - fade.y0))) : 1);
      const still = water ? out.waterStill : out.lava;
      const flow = water ? out.waterFlow : out.lava;
      const tile = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      if (!above) {
        const cs = corners('up', [0, 0, 0], [1, h, 1]).map((c) => [x + c[0], y + c[1], z + c[2]]);
        const a = alphaAt(y + h);
        still.quad(cs, tile(0, 0, 1, 1), [1, 1, 1, 1].map((v) => v * SHADE.up), [a, a, a, a]);
      }
      // Water inside a waterlogged block only shows its surface; the block itself covers the rest.
      if (m.kind !== 'fluid') return;
      const below = model(x, y - 1, z);
      if (!same(below) && !below.opaque) {
        const cs = corners('down', [0, 0, 0], [1, 1, 1]).map((c) => [x + c[0], y + c[1], z + c[2]]);
        const a = alphaAt(y);
        still.quad(cs, tile(0, 0, 1, 1), [SHADE.down, SHADE.down, SHADE.down, SHADE.down], [a, a, a, a]);
      }
      for (const face of ['north', 'south', 'west', 'east']) {
        const d = DIRS[face];
        const n = model(x + d[0], y, z + d[2]);
        if (n.opaque) continue;
        let bottom = 0;
        if (same(n)) {
          const nh = fluidHeight(n.kind === 'fluid' ? n : { kind: 'fluid', level: 0 }, same(model(x + d[0], y + 1, z + d[2])));
          if (nh >= h) continue;
          bottom = nh;
        }
        const cs = corners(face, [0, bottom, 0], [1, h, 1]).map((c) => [x + c[0], y + c[1], z + c[2]]);
        const uv = tile(0, 1 - h, 1, 1 - bottom);
        const shade = SHADE[face];
        flow.quad(cs, uv, [shade, shade, shade, shade], cs.map((c) => alphaAt(c[1])));
      }
    }

    const visit = (x, y, z) => {
      if (skip(x, y, z) && !cells) return;
      const idx = grid.get(x, y, z);
      const m = models[idx] ?? models[0];
      if (m.kind === 'none') return;
      if (m.unknown && typeof console !== 'undefined') console.warn('no model for', palette[idx]);
      const buf = m.layer === 'cutout' ? out.cutout : out.solid;
      if (m.kind === 'cube') {
        const cull = (nx, ny, nz) => {
          const n = model(nx, ny, nz);
          if (n.opaque) return true;
          return !!(m.cullSame && n.cullSame === m.cullSame);
        };
        addBox(buf, x, y, z, [0, 0, 0], [16, 16, 16], m.tex, cull);
      } else if (m.kind === 'boxes') {
        for (const b of m.boxes) addBox(buf, x, y, z, b.from, b.to, b.tex, (nx, ny, nz) => opaque(nx, ny, nz));
      } else if (m.kind === 'cross') {
        const [ox, oy, oz] = m.offset ? plantOffset(x, y, z, m.offset) : [0, 0, 0];
        const lo = 0.05, hi = 0.95;
        addPlane(out.cutout, x + ox, y + oy, z + oz, [lo, lo], [hi, hi], 0, 1, m.tex);
        addPlane(out.cutout, x + ox, y + oy, z + oz, [lo, hi], [hi, lo], 0, 1, m.tex);
      } else if (m.kind === 'crop') {
        const y0 = -1 / 16, y1 = 15 / 16;
        for (const p of [0.25, 0.75]) {
          addPlane(out.cutout, x, y, z, [p, 0], [p, 1], y0, y1, m.tex);
          addPlane(out.cutout, x, y, z, [0, p], [1, p], y0, y1, m.tex);
        }
      }
      if (m.kind === 'fluid' || m.water) addFluid(x, y, z, m);
    };

    if (cells) for (const [x, y, z] of cells) visit(x, y, z);
    else for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) visit(x, y, z);
    return Object.fromEntries(Object.entries(out).map(([k, b]) => [k, b.toArrays()]));
  }

  return { build, models };
}

export function decodeGrid(island, overrides = null) {
  const [sx, sy, sz] = island.size;
  const cells = new Uint16Array(sx * sy * sz);
  let o = 0;
  for (let i = 0; i < island.rle.length; i += 2) { cells.fill(island.rle[i + 1], o, o + island.rle[i]); o += island.rle[i]; }
  const index = (x, y, z) => (y * sz + z) * sx + x;
  const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  return {
    size: island.size,
    cells,
    get(x, y, z) {
      if (!inside(x, y, z)) return 0;
      if (overrides) { const v = overrides.get(index(x, y, z)); if (v !== undefined) return v; }
      return cells[index(x, y, z)];
    },
    index,
    inside,
  };
}
