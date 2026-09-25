// Block storage for the island region, filled from map_chunk and block change packets.
import chunkLoader from 'prismarine-chunk';
import blockLoader from 'prismarine-block';
import mcData from 'minecraft-data';
import { VERSION } from './mcpr.js';

export const TECHNICAL_BLOCKS = new Set([
  'command_block', 'chain_command_block', 'repeating_command_block', 'barrier', 'structure_block',
  'structure_void', 'jigsaw', 'light', 'moving_piston', 'end_gateway', 'end_portal', 'nether_portal',
]);
const AIR = new Set(['air', 'cave_air', 'void_air']);

export function createRegistry(version = VERSION) {
  const data = mcData(version);
  const Block = blockLoader(version);
  const cache = new Map();
  // "name" or "name[k=v,...]" in the order of the game's state definition.
  function stateString(id) {
    let s = cache.get(id);
    if (s !== undefined) return s;
    const b = Block.fromStateId(id, 0);
    const props = b.getProperties();
    const keys = Object.keys(props);
    s = keys.length ? `${b.name}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : b.name;
    cache.set(id, s);
    return s;
  }
  const blockName = (id) => data.blocksByStateId[id]?.name ?? 'air';
  return {
    version, data, stateString, blockName,
    Chunk: chunkLoader(version),
    isAir: (id) => AIR.has(blockName(id)),
    isTechnical: (id) => TECHNICAL_BLOCKS.has(blockName(id)),
  };
}

export class RegionWorld {
  constructor(region, registry) {
    this.min = region.min;
    this.max = region.max;
    this.size = region.max.map((v, i) => v - region.min[i] + 1);
    this.reg = registry;
    this.states = new Uint16Array(this.size[0] * this.size[1] * this.size[2]);
    this.loaded = new Set();
  }

  contains(x, y, z) {
    return x >= this.min[0] && x <= this.max[0] && y >= this.min[1] && y <= this.max[1] && z >= this.min[2] && z <= this.max[2];
  }

  index(x, y, z) {
    const [sx, , sz] = this.size;
    return ((y - this.min[1]) * sz + (z - this.min[2])) * sx + (x - this.min[0]);
  }

  get(x, y, z) {
    return this.contains(x, y, z) ? this.states[this.index(x, y, z)] : 0;
  }

  set(x, y, z, id) {
    if (!this.contains(x, y, z)) return false;
    this.states[this.index(x, y, z)] = id;
    return true;
  }

  clone() {
    const w = new RegionWorld({ min: this.min, max: this.max }, this.reg);
    w.states.set(this.states);
    w.loaded = new Set(this.loaded);
    return w;
  }

  loadChunk(p) {
    const cx = p.x * 16, cz = p.z * 16;
    if (cx > this.max[0] || cx + 15 < this.min[0] || cz > this.max[2] || cz + 15 < this.min[2]) return;
    const chunk = new this.reg.Chunk();
    chunk.load(p.chunkData, p.bitMap);
    const pos = { x: 0, y: 0, z: 0 };
    for (let x = Math.max(cx, this.min[0]); x <= Math.min(cx + 15, this.max[0]); x++) {
      for (let z = Math.max(cz, this.min[2]); z <= Math.min(cz + 15, this.max[2]); z++) {
        for (let y = this.min[1]; y <= this.max[1]; y++) {
          const section = y >> 4;
          if (!p.groundUp && !((p.bitMap >> section) & 1)) continue;
          pos.x = x - cx; pos.y = y; pos.z = z - cz;
          this.set(x, y, z, chunk.getBlockStateId(pos));
        }
      }
    }
    this.loaded.add(`${p.x},${p.z}`);
  }

  // Applies a block packet; returns the changes that fall inside the region.
  apply(name, p) {
    const out = [];
    if (name === 'block_change') {
      const { x, y, z } = p.location;
      if (this.set(x, y, z, p.type)) out.push({ x, y, z, state: p.type });
    } else if (name === 'multi_block_change') {
      const c = p.chunkCoordinates;
      for (const rec of p.records) {
        const v = BigInt(rec);
        const state = Number(v >> 12n);
        const local = Number(v & 0xfffn);
        const x = c.x * 16 + ((local >> 8) & 15), z = c.z * 16 + ((local >> 4) & 15), y = c.y * 16 + (local & 15);
        if (this.set(x, y, z, state)) out.push({ x, y, z, state });
      }
    } else if (name === 'map_chunk') {
      this.loadChunk(p);
    }
    return out;
  }
}

// Crops the region to the bounding box of visible blocks and run-length encodes it (y, then z, then x).
export function exportIsland(world, { keep = [] } = {}) {
  const reg = world.reg;
  const palette = ['air'];
  const paletteIndex = new Map([['air', 0]]);
  const counts = {};
  const technical = {};
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const grow = (x, y, z) => {
    lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
    hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
  };
  const [x0, y0, z0] = world.min, [x1, y1, z1] = world.max;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = world.get(x, y, z);
    if (reg.isAir(id)) continue;
    const name = reg.blockName(id);
    if (reg.isTechnical(id)) { technical[name] = (technical[name] || 0) + 1; continue; }
    counts[name] = (counts[name] || 0) + 1;
    grow(x, y, z);
  }
  for (const [x, y, z] of keep) grow(x, y, z);
  if (lo[0] === Infinity) return { origin: world.min, size: [0, 0, 0], palette, rle: [], counts, technical };
  const size = hi.map((v, i) => v - lo[i] + 1);
  const rle = [];
  let run = 0, cur = -1;
  for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
    const id = world.get(x, y, z);
    let idx = 0;
    if (!reg.isAir(id) && !reg.isTechnical(id)) {
      const s = reg.stateString(id);
      idx = paletteIndex.get(s);
      if (idx === undefined) { idx = palette.length; palette.push(s); paletteIndex.set(s, idx); }
    }
    if (idx === cur) run++;
    else { if (run) rle.push(run, cur); cur = idx; run = 1; }
  }
  if (run) rle.push(run, cur);
  return { origin: lo, size, palette, rle, counts, technical };
}

export function decodeIsland(island) {
  const [sx, sy, sz] = island.size;
  const cells = new Uint16Array(sx * sy * sz);
  let o = 0;
  for (let i = 0; i < island.rle.length; i += 2) {
    cells.fill(island.rle[i + 1], o, o + island.rle[i]);
    o += island.rle[i];
  }
  return { cells, get: (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : cells[(y * sz + z) * sx + x]) };
}
