// Synthetic replay: one bot that rejoins with a new entity id, a stranger, the recorder,
// a creeper, a bobber and a small chunk. Packets are built with the minecraft-protocol serializer.
import { encodeTmcpr, writeMcpr } from '../lib/mcpr.js';

export const RECORDER = { uuid: '00000000-0000-0000-0000-000000000001', name: 'Recorder' };
export const BOT = { uuid: '00000000-0000-0000-0000-000000000002', name: 'TestBot' };
export const STRANGER = { uuid: '00000000-0000-0000-0000-000000000003', name: 'Stranger' };
export const REGION = { min: [0, 60, 0], max: [15, 70, 15] };

const deg = (d) => Math.round((d * 256) / 360);

export function chunkPacket(reg, blocks, cx = 0, cz = 0) {
  const chunk = new reg.Chunk();
  for (const [x, y, z, name] of blocks) chunk.setBlockStateId({ x, y, z }, reg.data.blocksByName[name].defaultState);
  return {
    x: cx, z: cz, groundUp: true, bitMap: chunk.getMask(),
    heightmaps: { type: 'compound', name: '', value: {} },
    biomes: new Array(1024).fill(1), chunkData: chunk.dump(), blockEntities: [],
  };
}

const addPlayer = (p) => ({ name: 'player_info', params: { action: 'add_player', data: [{ uuid: p.uuid, name: p.name, properties: [], gamemode: 0, ping: 0 }] } });
const spawnPlayer = (id, p, x, y, z, yaw = 0, pitch = 0) => ({ name: 'named_entity_spawn', params: { entityId: id, playerUUID: p.uuid, x, y, z, yaw: deg(yaw), pitch: deg(pitch) } });

export function fixturePackets(reg) {
  const blocks = [];
  for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) blocks.push([x, 63, z, 'stone']);
  blocks.push([9, 64, 8, 'cobblestone'], [0, 64, 0, 'barrier'], [1, 64, 0, 'command_block'], [5, 50, 5, 'stone'], [6, 64, 6, 'wheat']);
  const creeper = reg.data.entitiesByName.creeper.id;
  const bobber = reg.data.entitiesByName.fishing_bobber.id;
  const list = [
    [0, { name: 'success', params: { uuid: RECORDER.uuid, username: RECORDER.name } }],
    [0, addPlayer(RECORDER)], [0, addPlayer(BOT)], [0, addPlayer(STRANGER)],
    [0, { name: 'map_chunk', params: chunkPacket(reg, blocks) }],
    [0, spawnPlayer(1, RECORDER, 5, 65, 5)],
    [0, spawnPlayer(10, BOT, 8.5, 64, 8.5, 90)],
    [0, spawnPlayer(11, STRANGER, 3.5, 64, 3.5)],
    [0, { name: 'entity_equipment', params: { entityId: 10, equipments: [{ slot: 0, item: { present: true, itemId: reg.data.itemsByName.diamond_pickaxe.id, itemCount: 1 } }] } }],
    [100, { name: 'entity_look', params: { entityId: 10, yaw: 0, pitch: deg(10), onGround: true } }],
    [200, { name: 'entity_head_rotation', params: { entityId: 10, headYaw: deg(-90) } }],
    [300, { name: 'rel_entity_move', params: { entityId: 10, dX: 4096, dY: 0, dZ: 0, onGround: true } }],
    [300, { name: 'rel_entity_move', params: { entityId: 11, dX: 4096, dY: 0, dZ: 0, onGround: true } }],
    [400, { name: 'animation', params: { entityId: 10, animation: 0 } }],
    [400, { name: 'block_break_animation', params: { entityId: 10, location: { x: 9, y: 64, z: 8 }, destroyStage: 3 } }],
    [450, { name: 'block_change', params: { location: { x: 9, y: 64, z: 8 }, type: 0 } }],
    [450, { name: 'world_event', params: { effectId: 2001, location: { x: 9, y: 64, z: 8 }, data: reg.data.blocksByName.cobblestone.defaultState, global: false } }],
    [450, { name: 'block_change', params: { location: { x: 5, y: 50, z: 5 }, type: 0 } }],
    [500, { name: 'spawn_entity_living', params: { entityId: 30, entityUUID: '00000000-0000-0000-0000-000000000030', type: creeper, x: 8.5, y: 64, z: 11.5, yaw: 0, pitch: 0, headPitch: 0, velocity: { x: 0, y: 0, z: 0 } } }],
    [550, { name: 'entity_status', params: { entityId: 30, entityStatus: 2 } }],
    [550, { name: 'entity_metadata', params: { entityId: 30, metadata: [{ key: 8, type: 2, value: 10 }] } }],
    [600, { name: 'entity_status', params: { entityId: 30, entityStatus: 3 } }],
    [700, { name: 'entity_destroy', params: { entityIds: [30] } }],
    [1000, { name: 'entity_destroy', params: { entityIds: [10] } }],
    [1000, { name: 'player_info', params: { action: 'remove_player', data: [{ uuid: BOT.uuid }] } }],
    [1100, addPlayer(BOT)],
    [1100, spawnPlayer(20, BOT, 9.5, 64, 8.5, 0)],
    [1200, { name: 'spawn_entity', params: { entityId: 40, objectUUID: '00000000-0000-0000-0000-000000000040', type: bobber, x: 9.5, y: 65.5, z: 9, pitch: 0, yaw: 0, objectData: 20, velocity: { x: 0, y: 1600, z: 4000 } } }],
    [1300, { name: 'rel_entity_move', params: { entityId: 40, dX: 0, dY: -4096, dZ: 8192, onGround: false } }],
    [1400, { name: 'entity_destroy', params: { entityIds: [40] } }],
    [1450, { name: 'block_change', params: { location: { x: 6, y: 64, z: 6 }, type: reg.data.blocksByName.wheat.defaultState + 3 } }],
    [1500, { name: 'animation', params: { entityId: 20, animation: 0 } }],
  ];
  return list.map(([t, p]) => ({ t, ...p }));
}

export async function fixtureMcpr(reg) {
  const meta = { singleplayer: false, duration: 1500, mcversion: '1.16.5', fileFormat: 'MCPR', fileFormatVersion: 14, protocol: 754, generator: 'fixture' };
  return writeMcpr(meta, encodeTmcpr(fixturePackets(reg)));
}
