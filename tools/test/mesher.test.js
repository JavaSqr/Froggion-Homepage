import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMesher } from '../../src/scene/mesher.js';
import { modelFor, plantOffset } from '../../src/scene/blocks.js';

// A tiny island: cells as { 'x,y,z': state } inside a 6×6×6 box.
function grid(cells) {
  const palette = ['air', ...new Set(Object.values(cells))];
  const index = new Map(palette.map((s, i) => [s, i]));
  return {
    palette,
    grid: {
      size: [6, 6, 6],
      get: (x, y, z) => index.get(cells[`${x},${y},${z}`] ?? 'air'),
    },
  };
}

function mesh(cells, opts = {}) {
  const { palette, grid: g } = grid(cells);
  const uvOf = () => [0, 0, 1, 1];
  return createMesher({ palette, uvOf, fade: opts.fade }).build(g, opts);
}

test('hidden faces between opaque cubes are culled', () => {
  const out = mesh({ '1,1,1': 'stone', '2,1,1': 'stone' });
  assert.equal(out.solid.quads, 10);
});

test('faces get the game shading: top 1, bottom 0.5, north/south 0.8, east/west 0.6', () => {
  const out = mesh({ '1,1,1': 'dirt' });
  const shades = new Set();
  for (let i = 0; i < out.solid.color.length; i += 4) shades.add(Math.round(out.solid.color[i] * 100) / 100);
  assert.deepEqual([...shades].sort(), [0.5, 0.6, 0.8, 1]);
});

test('corner ambient occlusion darkens a floor next to a wall', () => {
  const out = mesh({ '1,1,1': 'stone', '2,1,1': 'stone', '2,2,1': 'stone' });
  const tops = [];
  for (let q = 0; q < out.solid.quads; q++) {
    const ys = [1, 4, 7, 10].map((o) => out.solid.position[q * 12 + o]);
    const xs = [0, 3, 6, 9].map((o) => out.solid.position[q * 12 + o]);
    if (ys.every((y) => y === 2) && xs.every((x) => x <= 2)) tops.push([0, 1, 2, 3].map((v) => out.solid.color[(q * 4 + v) * 4]));
  }
  assert.equal(tops.length, 1);
  assert.ok(Math.min(...tops[0]) < 1 && Math.max(...tops[0]) === 1);
});

test('glass culls against glass, leaves do not cull each other', () => {
  assert.equal(mesh({ '1,1,1': 'glass', '2,1,1': 'glass' }).cutout.quads, 10);
  assert.equal(mesh({ '1,1,1': 'oak_leaves[persistent=true,distance=1]', '2,1,1': 'oak_leaves[persistent=true,distance=1]' }).cutout.quads, 12);
});

test('partial blocks: slab against stone, farmland top is never culled', () => {
  const slab = mesh({ '1,1,1': 'stone_brick_slab[type=bottom,waterlogged=false]', '2,1,1': 'stone' });
  // Slab: 6 faces minus the east side touching stone; stone keeps its west face (slab is not opaque).
  assert.equal(slab.solid.quads, 5 + 6);
  const farm = mesh({ '1,1,1': 'farmland[moisture=7]', '1,2,1': 'stone' });
  assert.equal(farm.solid.quads, 6 + 6);
});

test('plants are crossed planes, crops are four planes with a stage texture', () => {
  assert.equal(mesh({ '1,1,1': 'grass' }).cutout.quads, 2);
  assert.equal(mesh({ '1,1,1': 'wheat[age=5]' }).cutout.quads, 4);
  assert.equal(modelFor('wheat[age=5]').tex, 'block/wheat_stage5');
  const [ox, oy, oz] = plantOffset(10, 64, -3, 'xyz');
  assert.ok(Math.abs(ox) <= 0.25 && Math.abs(oz) <= 0.25 && oy <= 0 && oy >= -0.2);
});

test('water: source surface below the top, falling water is a full column that fades out', () => {
  const pond = mesh({ '1,1,1': 'water[level=0]', '2,1,1': 'water[level=0]' });
  assert.equal(pond.waterStill.quads, 2 + 2);
  assert.equal(pond.waterFlow.quads, 6);
  const topY = Math.max(...pond.waterStill.position.filter((_, i) => i % 3 === 1));
  assert.ok(Math.abs(topY - (1 + 8 / 9)) < 1e-6);
  const fall = mesh({ '1,1,1': 'water[level=8]', '1,2,1': 'water[level=8]', '1,3,1': 'water[level=8]' }, { fade: { y0: 1, y1: 3.5 } });
  const sideTop = Math.max(...fall.waterFlow.position.filter((_, i) => i % 3 === 1));
  assert.ok(Math.abs(sideTop - (3 + 8 / 9)) < 1e-6);
  const alphas = [];
  for (let i = 0; i < fall.waterFlow.color.length; i += 4) alphas.push(fall.waterFlow.color[i + 3]);
  assert.equal(Math.min(...alphas), 0);
  assert.equal(Math.max(...alphas), 1);
});

test('waterlogged stairs: stair boxes plus only the water surface', () => {
  const out = mesh({ '1,1,1': 'stone_brick_stairs[waterlogged=true,shape=straight,half=bottom,facing=west]' });
  assert.equal(out.solid.quads, 12);
  assert.equal(out.waterStill.quads, 1);
  assert.equal(out.waterFlow.quads, 0);
});

test('dynamic cells are skipped in the static mesh and built on their own', () => {
  const cells = { '1,1,1': 'cobblestone', '2,1,1': 'stone' };
  const skip = (x, y, z) => x === 1 && y === 1 && z === 1;
  assert.equal(mesh(cells, { skip }).solid.quads, 6);
  assert.equal(mesh(cells, { cells: [[1, 1, 1]] }).solid.quads, 5);
});

test('technical or unknown blocks do not crash the mesher', () => {
  assert.equal(modelFor('air').kind, 'none');
  assert.equal(modelFor('some_modded_block').unknown, true);
});
