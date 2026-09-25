import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, RegionWorld, exportIsland, decodeIsland } from '../lib/world.js';
import { chunkPacket } from './fixture.js';

const reg = createRegistry();
const region = { min: [0, 60, 0], max: [7, 66, 7] };

function world(blocks) {
  const w = new RegionWorld(region, reg);
  w.apply('map_chunk', chunkPacket(reg, blocks));
  return w;
}

test('island is cropped to visible blocks, technical blocks and outside blocks are dropped', () => {
  const w = world([
    [2, 61, 2, 'stone'], [3, 61, 2, 'stone'], [3, 62, 3, 'grass_block'], [2, 62, 2, 'water'],
    [5, 62, 5, 'barrier'], [6, 62, 5, 'command_block'], [4, 55, 4, 'stone'], [12, 61, 12, 'stone'],
  ]);
  const island = exportIsland(w);
  assert.deepEqual(island.origin, [2, 61, 2]);
  assert.deepEqual(island.size, [2, 2, 2]);
  assert.deepEqual(island.counts, { stone: 2, grass_block: 1, water: 1 });
  assert.deepEqual(island.technical, { barrier: 1, command_block: 1 });
  assert.ok(!island.palette.some((p) => p.startsWith('barrier') || p.startsWith('command_block')));
  const { get } = decodeIsland(island);
  const at = (x, y, z) => island.palette[get(x - 2, y - 61, z - 2)];
  assert.equal(at(2, 61, 2), 'stone');
  assert.equal(at(3, 62, 3), 'grass_block[snowy=false]');
  assert.equal(at(2, 62, 2), 'water[level=0]');
  assert.equal(at(3, 62, 2), 'air');
});

test('block changes inside the region update the island, outside ones are ignored', () => {
  const w = world([[1, 61, 1, 'stone']]);
  const cobble = reg.data.blocksByName.cobblestone.defaultState;
  assert.deepEqual(w.apply('block_change', { location: { x: 1, y: 61, z: 1 }, type: cobble }), [{ x: 1, y: 61, z: 1, state: cobble }]);
  assert.deepEqual(w.apply('block_change', { location: { x: 9, y: 61, z: 1 }, type: cobble }), []);
  const records = [BigInt(cobble) << 12n | (2n << 8n) | (3n << 4n) | 13n];
  assert.deepEqual(w.apply('multi_block_change', { chunkCoordinates: { x: 0, z: 0, y: 3 }, records }), [{ x: 2, y: 61, z: 3, state: cobble }]);
  const island = exportIsland(w, { keep: [[4, 64, 4]] });
  assert.deepEqual(island.counts, { cobblestone: 2 });
  assert.deepEqual(island.origin, [1, 61, 1]);
  assert.deepEqual(island.size, [4, 4, 4]);
});
