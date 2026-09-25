import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, RegionWorld } from '../lib/world.js';
import { pourLava } from '../lib/fluids.js';

const reg = createRegistry();
const stone = reg.data.blocksByName.stone.minStateId;

function floorWorld(size = 12, height = 10) {
  const w = new RegionWorld({ min: [0, 0, 0], max: [size, height, size] }, reg);
  for (let x = 0; x <= size; x++) for (let z = 0; z <= size; z++) w.set(x, 0, z, stone);
  return w;
}

test('lava on a floor spreads three blocks, two levels per block', () => {
  const w = floorWorld();
  const cells = pourLava(w, reg, [[6, 1, 6]]);
  assert.equal(cells.length, 25);
  assert.equal(reg.stateString(w.get(6, 1, 6)), 'lava[level=0]');
  assert.equal(reg.stateString(w.get(8, 1, 6)), 'lava[level=4]');
  assert.equal(reg.stateString(w.get(9, 1, 6)), 'lava[level=6]');
  assert.equal(reg.stateString(w.get(10, 1, 6)), 'air');
});

test('lava in a wall notch falls to the floor, then spreads', () => {
  const w = floorWorld(4);
  w.set(2, 8, 2, stone); // roof of the notch
  pourLava(w, reg, [[2, 7, 2]]);
  for (let y = 1; y < 7; y++) assert.equal(reg.stateString(w.get(2, y, 2)), 'lava[level=8]');
  assert.equal(reg.stateString(w.get(3, 1, 2)), 'lava[level=2]');
  assert.equal(reg.stateString(w.get(2, 7, 3)), 'air', 'a source that can fall does not spread sideways');
});

test('lava can only be poured into an empty cell', () => {
  const w = floorWorld();
  assert.throws(() => pourLava(w, reg, [[6, 0, 6]]), /not an empty cell/);
});
