// Block state → render model. Coordinates are in pixels (0..16) like block model JSON.
// Texture names are paths under public/textures/ without extension.

export function parseState(s) {
  const m = /^([a-z0-9_]+)(?:\[(.*)\])?$/.exec(s);
  const props = {};
  if (m?.[2]) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); props[k] = v; }
  return { name: m ? m[1] : s, props };
}

const AIR = new Set(['air', 'cave_air', 'void_air']);
const SIMPLE = new Set(['stone', 'andesite', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'mossy_stone_bricks', 'dirt', 'sand', 'emerald_ore', 'granite', 'diorite', 'gravel', 'coarse_dirt']);
const PLANKS = { birch: 'block/birch_planks', crimson: 'block/crimson_planks', oak: 'block/birch_planks' };

const all = (t) => ({ up: t, down: t, north: t, south: t, east: t, west: t });
const box = (from, to, tex) => ({ from, to, tex });

function slabBoxes(type, tex) {
  if (type === 'top') return [box([0, 8, 0], [16, 16, 16], tex)];
  if (type === 'double') return [box([0, 0, 0], [16, 16, 16], tex)];
  return [box([0, 0, 0], [16, 8, 16], tex)];
}

// Straight stairs: a slab plus a half block on the facing side.
function stairBoxes(p, tex) {
  const top = p.half === 'top';
  const slab = top ? box([0, 8, 0], [16, 16, 16], tex) : box([0, 0, 0], [16, 8, 16], tex);
  const y0 = top ? 0 : 8, y1 = top ? 8 : 16;
  const step = {
    east: box([8, y0, 0], [16, y1, 16], tex),
    west: box([0, y0, 0], [8, y1, 16], tex),
    south: box([0, y0, 8], [16, y1, 16], tex),
    north: box([0, y0, 0], [16, y1, 8], tex),
  }[p.facing ?? 'north'];
  return [slab, step];
}

function trapdoorBox(p) {
  if (p.open !== 'true') return p.half === 'top' ? [[0, 13, 0], [16, 16, 16]] : [[0, 0, 0], [16, 3, 16]];
  return {
    north: [[0, 0, 13], [16, 16, 16]],
    south: [[0, 0, 0], [16, 16, 3]],
    west: [[13, 0, 0], [16, 16, 16]],
    east: [[0, 0, 0], [3, 16, 16]],
  }[p.facing];
}

function wallSignBox(facing) {
  return {
    north: [[0, 4.5, 14], [16, 12.5, 16]],
    south: [[0, 4.5, 0], [16, 12.5, 2]],
    east: [[0, 4.5, 0], [2, 12.5, 16]],
    west: [[14, 4.5, 0], [16, 12.5, 16]],
  }[facing];
}

function buttonBox(p) {
  const pressed = p.powered === 'true' ? 1 : 2;
  const ns = p.facing === 'north' || p.facing === 'south';
  if (p.face === 'floor') return ns ? [[5, 0, 6], [11, pressed, 10]] : [[6, 0, 5], [10, pressed, 11]];
  if (p.face === 'ceiling') return ns ? [[5, 16 - pressed, 6], [11, 16, 10]] : [[6, 16 - pressed, 5], [10, 16, 11]];
  return {
    north: [[5, 6, 16 - pressed], [11, 10, 16]],
    south: [[5, 6, 0], [11, 10, pressed]],
    west: [[16 - pressed, 6, 5], [16, 10, 11]],
    east: [[0, 6, 5], [pressed, 10, 11]],
  }[p.facing];
}

// Model kinds: none | cube | boxes | cross | crop | fluid. `water` marks waterlogged blocks.
export function modelFor(state) {
  const { name, props: p } = parseState(state);
  const m = buildModel(name, p);
  if (p.waterlogged === 'true') m.water = true;
  return m;
}

function buildModel(name, p) {
  if (AIR.has(name)) return { kind: 'none' };
  if (SIMPLE.has(name)) return { kind: 'cube', tex: all(`block/${name}`), opaque: true };
  switch (name) {
    case 'grass_block':
      return { kind: 'cube', opaque: true, tex: { up: 'block/grass_block_top', down: 'block/dirt', north: 'block/grass_block_side', south: 'block/grass_block_side', east: 'block/grass_block_side', west: 'block/grass_block_side' } };
    case 'oak_log': {
      const side = 'block/oak_log', end = 'block/oak_log_top';
      const axis = p.axis ?? 'y';
      const tex = all(side);
      if (axis === 'y') { tex.up = end; tex.down = end; }
      if (axis === 'x') { tex.east = end; tex.west = end; }
      if (axis === 'z') { tex.north = end; tex.south = end; }
      return { kind: 'cube', opaque: true, tex };
    }
    case 'oak_leaves':
      return { kind: 'cube', tex: all('block/oak_leaves'), layer: 'cutout' };
    case 'glass':
      return { kind: 'cube', tex: all('block/glass'), layer: 'cutout', cullSame: 'glass' };
    case 'farmland':
      return { kind: 'boxes', boxes: [box([0, 0, 0], [16, 15, 16], { ...all('block/dirt'), up: 'block/farmland_moist' })] };
    case 'grass_path':
      return { kind: 'boxes', boxes: [box([0, 0, 0], [16, 15, 16], { ...all('block/grass_path_side'), up: 'block/grass_path_top', down: 'block/dirt' })] };
    case 'cobblestone_slab':
      return { kind: 'boxes', boxes: slabBoxes(p.type, all('block/cobblestone')), fullIfDouble: p.type === 'double' };
    case 'stone_brick_slab':
      return { kind: 'boxes', boxes: slabBoxes(p.type, all('block/stone_bricks')) };
    case 'stone_brick_stairs':
      return { kind: 'boxes', boxes: stairBoxes(p, all('block/stone_bricks')) };
    case 'warped_trapdoor': {
      const [from, to] = trapdoorBox(p);
      return { kind: 'boxes', layer: 'cutout', boxes: [box(from, to, all('block/warped_trapdoor'))] };
    }
    case 'stone_button': {
      const [from, to] = buttonBox(p);
      return { kind: 'boxes', boxes: [box(from, to, all('block/stone'))] };
    }
    case 'wheat':
      return { kind: 'crop', tex: `block/wheat_stage${p.age ?? 0}` };
    case 'grass':
      return { kind: 'cross', tex: 'block/grass', offset: 'xyz' };
    case 'fern':
      return { kind: 'cross', tex: 'block/fern', offset: 'xyz' };
    case 'orange_tulip':
      return { kind: 'cross', tex: 'block/orange_tulip', offset: 'xz' };
    case 'water':
      return { kind: 'fluid', fluid: 'water', level: Number(p.level ?? 0) };
    case 'lava':
      return { kind: 'fluid', fluid: 'lava', level: Number(p.level ?? 0) };
    default:
      break;
  }
  const slab = /^(\w+)_slab$/.exec(name);
  if (slab && PLANKS[slab[1]]) return { kind: 'boxes', boxes: slabBoxes(p.type, all(PLANKS[slab[1]])) };
  const sign = /^(\w+)_wall_sign$/.exec(name);
  if (sign) {
    const [from, to] = wallSignBox(p.facing);
    return { kind: 'boxes', boxes: [box(from, to, all(PLANKS[sign[1]] ?? 'block/birch_planks'))] };
  }
  return { kind: 'cube', tex: all('block/stone'), opaque: true, unknown: true };
}

export function texturesOf(model) {
  const out = new Set();
  if (model.kind === 'cube') Object.values(model.tex).forEach((t) => out.add(t));
  if (model.kind === 'boxes') model.boxes.forEach((b) => Object.values(b.tex).forEach((t) => out.add(t)));
  if (model.kind === 'cross' || model.kind === 'crop') out.add(model.tex);
  return out;
}

// Vanilla random XZ(Y) offset for plants (Mth.getSeed), in blocks.
export function plantOffset(x, y, z, type) {
  const M = (1n << 64n) - 1n;
  const toS64 = (v) => BigInt.asIntN(64, v & M);
  let l = toS64(BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n) ^ BigInt(y));
  l = toS64(l * l * 42317861n + l * 11n);
  const i = l >> 16n;
  const ox = (Number(i & 15n) / 15 - 0.5) * 0.5;
  const oz = (Number((i >> 8n) & 15n) / 15 - 0.5) * 0.5;
  const oy = type === 'xyz' ? (Number((i >> 4n) & 15n) / 15 - 1) * 0.2 : 0;
  return [ox, oy, oz];
}
