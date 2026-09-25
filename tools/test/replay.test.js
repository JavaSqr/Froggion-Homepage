import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMcpr, parseTmcpr, encodeTmcpr } from '../lib/mcpr.js';
import { createRegistry } from '../lib/world.js';
import { simulate } from '../lib/simulate.js';
import { assignZones, zoneTimeline, loopCost } from '../lib/loops.js';
import { convert } from '../replay-to-timeline.js';
import { fixturePackets, fixtureMcpr, REGION, BOT, RECORDER } from './fixture.js';

const reg = createRegistry();
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

async function runFixture() {
  const { packets } = await readMcpr(await fixtureMcpr(reg));
  return simulate(packets, { registry: reg, region: REGION, recorder: RECORDER.name, nicks: [BOT.name] });
}

test('tmcpr round trip starts in login and switches to play after success', () => {
  const packets = parseTmcpr(encodeTmcpr(fixturePackets(reg)));
  assert.equal(packets[0].name, 'success');
  assert.equal(packets[0].state, 'login');
  assert.equal(packets[1].state, 'play');
  assert.equal(packets.find((p) => p.name === 'map_chunk').params.x, 0);
});

test('bots are matched by UUID across a rejoin; recorder and strangers are dropped', async () => {
  const sim = await runFixture();
  assert.equal(sim.bots.length, 1);
  const bot = sim.bots[0];
  assert.deepEqual(bot.entityIds, [10, 20]);
  assert.equal(sim.skipped.recorder, 1);
  assert.deepEqual([...sim.skipped.strangers], ['Stranger']);
  // Destroyed at t=1000 (tick 20), back at t=1100 (tick 22) under entity 20.
  assert.ok(bot.samples[19]);
  assert.equal(bot.samples[20], undefined);
  assert.equal(bot.samples[21], undefined);
  near(bot.samples[22][0], 9.5);
  assert.deepEqual(bot.events.filter((e) => e[1] === 'spawn' || e[1] === 'despawn').map((e) => e.slice(0, 2)), [[20, 'despawn'], [22, 'spawn']]);
  assert.deepEqual(bot.events.filter((e) => e[1] === 'swing').map((e) => e[0]), [8, 30]);
});

test('client-side lerp: 3 steps for position and rotation, head follows yaw until its own packet', async () => {
  const { bots: [bot] } = await runFixture();
  const s = bot.samples;
  near(s[1][3], 90);
  near(s[2][3], 60); near(s[3][3], 30); near(s[4][3], 0);
  near(s[2][5], s[2][3]); near(s[3][5], s[3][3]);
  near(s[7][5], -90);
  near(s[6][0], 8.5 + 1 / 3); near(s[7][0], 8.5 + 2 / 3); near(s[8][0], 9.5);
  near(s[3][4], (7 * 360 / 256) * 2 / 3);
});

test('entities, blocks and cracks are extracted and assigned to the bot zone', async () => {
  const sim = await runFixture();
  const creeper = sim.entities.find((e) => e.kind === 'creeper');
  assert.equal(creeper.spawn, 10);
  assert.equal(creeper.despawn, 14);
  assert.deepEqual(creeper.events.map((e) => e.slice(0, 2)), [[11, 'hurt'], [11, 'health'], [12, 'death']]);
  const bobber = sim.entities.find((e) => e.kind === 'fishing_bobber');
  assert.equal(bobber.owner, BOT.name);
  assert.equal(bobber.samples.length, 4);
  near(bobber.samples[2][2], 11);
  assert.deepEqual(sim.blockChanges.map((c) => [c.k, c.x, c.y, c.z, reg.stateString(c.state)]), [[9, 9, 64, 8, 'air'], [29, 6, 64, 6, 'wheat[age=3]']]);
  assert.deepEqual(sim.cracks.map((c) => [c.k, c.stage, c.by]), [[8, 3, BOT.name]]);
  assert.ok(sim.effects.some((e) => e.type === 'event' && e.id === 2001));
  const zone = assignZones(sim).get(BOT.name);
  assert.equal(zone.entities.length, 2);
  assert.equal(zone.blocks.length, 2);
  const tl = zoneTimeline(sim, zone);
  assert.equal(loopCost(reg, tl, 1, 5).blocks, 0);
  assert.ok(loopCost(reg, tl, 1, 12).blocks > 0);
});

test('convert writes a looped scene for the chosen bounds', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'froggion-'));
  fs.mkdirSync(path.join(root, 'source/replays'), { recursive: true });
  fs.writeFileSync(path.join(root, 'source/replays/Test.mcpr'), await fixtureMcpr(reg));
  fs.writeFileSync(path.join(root, 'source/scene.json'), JSON.stringify({ replays: ['replays/Test.mcpr'], recorder: RECORDER.name, region: REGION }));
  fs.writeFileSync(path.join(root, 'source/bots.json'), JSON.stringify({ bots: [{ nick: BOT.name, job: 'mine', slug: 'test', skin: 'skins/TestBot.png', model: 'classic' }] }));
  fs.writeFileSync(path.join(root, 'source/loops.json'), JSON.stringify({ [BOT.name]: { replay: 'Test', from: 2, to: 30 } }));
  const { scene, island } = await convert({ root, log: () => {} });
  const b = scene.bots[0];
  assert.equal(b.length, 28);
  assert.deepEqual(b.hidden, [[18, 20]]);
  assert.deepEqual(scene.origin, island.origin);
  // Decode x: 8.5 → 9.5 over ticks 6..8 (loop ticks 4..6).
  let x = 0;
  const xs = b.track.x.map((d) => (x += d) / scene.posScale + scene.origin[0]);
  near(xs[0], 8.5); near(xs[6], 9.5, 1 / 64);
  assert.deepEqual(b.events[0], [0, 'equip', 0, 'diamond_pickaxe']);
  const pal = (i) => scene.palette[i];
  assert.deepEqual(b.blocks.init.map((c) => [c[0] + scene.origin[0], c[1] + scene.origin[1], c[2] + scene.origin[2], pal(c[3])]).sort(), [[6, 64, 6, 'wheat[age=0]'], [9, 64, 8, 'cobblestone']]);
  assert.deepEqual(b.blocks.changes.map((c) => [c[0], pal(c[4])]), [[7, 'air'], [27, 'wheat[age=3]']]);
  assert.deepEqual(b.entities.map((e) => [e.kind, e.from, e.to]), [['creeper', 8, 12], ['fishing_bobber', 22, 26]]);
  assert.ok(fs.existsSync(path.join(root, 'public/data/scene.json')));
  assert.ok(fs.existsSync(path.join(root, 'reports/replays.md')));
});
