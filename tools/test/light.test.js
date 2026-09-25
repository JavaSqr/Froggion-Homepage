import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLight, nightLightmap } from '../../src/scene/light.js';
import { createMesher } from '../../src/scene/mesher.js';
import { modelFor } from '../../src/scene/blocks.js';

function world(cells, size = [9, 6, 9]) {
  const palette = ['air', ...new Set(Object.values(cells))];
  const index = new Map(palette.map((s, i) => [s, i]));
  const grid = { size, get: (x, y, z) => index.get(cells[`${x},${y},${z}`] ?? 'air') ?? 0 };
  return { palette, grid, models: palette.map((s) => modelFor(s)) };
}

test('block light drops by one per block from a torch, walls stop it', () => {
  const floor = {};
  for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) floor[`${x},0,${z}`] = 'stone';
  const w = world({ ...floor, '4,1,4': 'torch' });
  const l = computeLight(w.grid, w.models);
  assert.equal(l.at(4, 1, 4)[0], 14);
  assert.equal(l.at(5, 1, 4)[0], 13);
  assert.equal(l.at(7, 1, 4)[0], 11);
  assert.equal(l.at(4, 0, 4)[0], 0, 'opaque blocks stay dark inside');
  const walled = world({ ...floor, '4,1,4': 'torch', '5,1,4': 'stone', '5,2,4': 'stone', '5,1,3': 'stone', '5,1,5': 'stone' });
  assert.ok(computeLight(walled.grid, walled.models).at(6, 1, 4)[0] < 12);
});

test('lanterns and lava glow at 15; leaves and water dim light a little more', () => {
  const w = world({ '1,1,1': 'lantern[hanging=false,waterlogged=false]', '3,1,1': 'lava[level=0]' });
  const l = computeLight(w.grid, w.models);
  assert.equal(l.at(1, 1, 1)[0], 15);
  assert.equal(l.at(3, 1, 1)[0], 15);
  const leaves = world({ '0,1,1': 'torch', '1,1,1': 'oak_leaves[persistent=true,distance=1]' });
  assert.equal(computeLight(leaves.grid, leaves.models).at(1, 1, 1)[0], 12);
});

test('sky light: full in open columns, spreads sideways under roofs', () => {
  const w = world({ '4,4,4': 'stone' });
  const l = computeLight(w.grid, w.models);
  assert.equal(l.at(0, 0, 0)[1], 15);
  assert.equal(l.at(4, 5, 4)[1], 15);
  assert.equal(l.at(4, 3, 4)[1], 14);
  assert.equal(l.at(4, 4, 4)[1], 0);
});

test('night lightmap: warm torch light, blue moonlight, near black in the dark', () => {
  const map = nightLightmap();
  const [r, g, b] = map(14, 0);
  assert.ok(r > g && g > b && r > 0.6);
  const [mr, , mb] = map(0, 15);
  assert.ok(mb > mr && mb < 0.35);
  assert.ok(map(0, 0).every((c) => c < 0.05));
});

test('baked light makes faces near a torch brighter than faces far away', () => {
  const cells = { '8,1,4': 'torch' };
  for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) cells[`${x},0,${z}`] = 'stone';
  const w = world(cells);
  const light = computeLight(w.grid, w.models);
  const out = createMesher({ palette: w.palette, uvOf: () => [0, 0, 1, 1], lighting: { light, map: nightLightmap() } }).build(w.grid);
  const topAt = (x, z) => {
    for (let q = 0; q < out.solid.quads; q++) {
      const p = out.solid.position.slice(q * 12, q * 12 + 12);
      if (p[1] === 1 && p[4] === 1 && Math.min(p[0], p[3], p[6], p[9]) === x && Math.min(p[2], p[5], p[8], p[11]) === z) return out.solid.color[q * 16];
    }
    return null;
  };
  assert.ok(topAt(7, 4) > topAt(0, 4) * 3);
});
