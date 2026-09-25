// Replays clientbound packets tick by tick the way the vanilla 1.16 client sees them.
// Output: per-tick samples for players and entities, events, block changes and effects.
import { RegionWorld } from './world.js';

export const TICK_MS = 50;
const ANGLE = 360 / 256;

const wrapDeg = (a) => {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
};

// Gravity and drag per tick for entities the client moves by itself between packets.
const PHYSICS = {
  item: [0.04, 0.98],
  experience_orb: [0.03, 0.98],
  fishing_bobber: [0.03, 0.92],
  default: [0.04, 0.98],
};

export function simulate(packets, { registry, region, recorder, nicks }) {
  const reg = registry;
  const data = reg.data;
  const nameByUuid = new Map();
  const ents = new Map();
  const bots = new Map(nicks.map((n) => [n, { nick: n, entityIds: [], samples: [], events: [], uuid: null }]));
  const records = [];
  const world = new RegionWorld(region, reg);
  const blockChanges = [];
  const cracks = [];
  const effects = [];
  const skipped = { recorder: 0, strangers: new Set() };
  let initialWorld = null;
  let tick = 0;

  function spawnCommon(id, kind, x, y, z, yaw, pitch, head, extra = {}) {
    const e = {
      id, kind, living: false, x, y, z, yaw, pitch, head, spawnTick: tick,
      px: Math.round(x * 4096), py: Math.round(y * 4096), pz: Math.round(z * 4096),
      lerp: null, headLerp: null, headKnown: true, vel: [0, 0, 0], meta: {}, equip: {},
      ...extra,
    };
    ents.set(id, e);
    return e;
  }

  function attachRecord(e, k) {
    if (e.bot) return;
    e.rec = { id: e.id, kind: e.kind, owner: e.owner ?? null, spawn: k, despawn: null, keys: [], samples: [], events: [], meta: {} };
    records.push(e.rec);
  }

  function packetPos(e) {
    return [e.px / 4096, e.py / 4096, e.pz / 4096];
  }

  function onMove(e, pos, yaw, pitch, k, teleport) {
    if (e.living) {
      let target = pos;
      if (teleport && Math.abs(e.x - pos[0]) < 0.03125 && Math.abs(e.y - pos[1]) < 0.015625 && Math.abs(e.z - pos[2]) < 0.03125) target = [e.x, e.y, e.z];
      if (!pos) target = [e.x, e.y, e.z];
      e.lerp = { x: target[0], y: target[1], z: target[2], yaw: yaw ?? e.yaw, pitch: pitch ?? e.pitch, steps: 3 };
    } else {
      if (pos) { e.x = pos[0]; e.y = pos[1]; e.z = pos[2]; }
      if (yaw != null) { e.yaw = yaw; e.pitch = pitch; }
      if (pos) e.rec?.keys.push({ k, pos: [e.x, e.y, e.z], vel: [...e.vel] });
    }
  }

  // One client tick: lerp living entities, move others by their own physics, record samples.
  function finishTick(k) {
    if (!initialWorld) initialWorld = world.clone();
    for (const e of ents.values()) {
      if (e.living) {
        if (e.lerp && e.lerp.steps > 0) {
          const l = e.lerp;
          e.x += (l.x - e.x) / l.steps;
          e.y += (l.y - e.y) / l.steps;
          e.z += (l.z - e.z) / l.steps;
          e.yaw += wrapDeg(l.yaw - e.yaw) / l.steps;
          e.pitch += (l.pitch - e.pitch) / l.steps;
          l.steps--;
        }
        if (e.headLerp && e.headLerp.steps > 0) {
          e.head += wrapDeg(e.headLerp.v - e.head) / e.headLerp.steps;
          e.headLerp.steps--;
        }
        if (!e.headKnown) e.head = e.yaw;
      }
      const s = [e.x, e.y, e.z, e.yaw, e.pitch, e.head];
      if (e.bot) {
        const b = bots.get(e.bot);
        b.samples[k] = s;
      } else if (e.rec) {
        e.rec.samples.push(s);
      }
    }
  }

  function destroy(id, k) {
    const e = ents.get(id);
    if (!e) return;
    ents.delete(id);
    if (e.rec) e.rec.despawn = k;
  }

  const botOf = (id) => ents.get(id)?.bot ?? null;
  const emit = (e, k, ev) => {
    if (!e) return;
    if (e.bot) bots.get(e.bot).events.push([k, ...ev]);
    else if (e.rec) e.rec.events.push([k, ...ev]);
  };

  for (const p of packets) {
    if (p.state !== 'play') {
      continue;
    }
    const k = Math.round(p.t / TICK_MS);
    while (tick < k) finishTick(tick++);
    const live = p.t > 0; // the t=0 burst only builds the initial state
    const a = p.params;
    switch (p.name) {
      case 'player_info':
        if (a.action === 'add_player') for (const d of a.data) nameByUuid.set(d.uuid, d.name);
        break;
      case 'named_entity_spawn': {
        const nick = nameByUuid.get(a.playerUUID);
        if (nick === recorder) { skipped.recorder++; break; }
        if (!bots.has(nick)) { skipped.strangers.add(nick ?? a.playerUUID); break; }
        spawnCommon(a.entityId, 'player', a.x, a.y, a.z, a.yaw * ANGLE, a.pitch * ANGLE, a.yaw * ANGLE, { living: true, bot: nick, headKnown: false });
        const b = bots.get(nick);
        b.uuid = a.playerUUID;
        b.entityIds.push(a.entityId);
        if (live) b.events.push([k, 'spawn']);
        break;
      }
      case 'spawn_entity_living': {
        const kind = data.entities[a.type]?.name ?? `entity_${a.type}`;
        const e = spawnCommon(a.entityId, kind, a.x, a.y, a.z, a.yaw * ANGLE, a.pitch * ANGLE, a.headPitch * ANGLE, { living: true });
        e.vel = [a.velocity.x / 8000, a.velocity.y / 8000, a.velocity.z / 8000];
        attachRecord(e, k);
        break;
      }
      case 'spawn_entity': {
        const kind = data.entities[a.type]?.name ?? `entity_${a.type}`;
        const extra = {};
        if (kind === 'fishing_bobber') extra.owner = botOf(a.objectData) ?? `#${a.objectData}`;
        const e = spawnCommon(a.entityId, kind, a.x, a.y, a.z, a.yaw * ANGLE, a.pitch * ANGLE, a.yaw * ANGLE, extra);
        e.vel = [a.velocity.x / 8000, a.velocity.y / 8000, a.velocity.z / 8000];
        attachRecord(e, k);
        e.rec.keys.push({ k, pos: [e.x, e.y, e.z], vel: [...e.vel] });
        break;
      }
      case 'spawn_entity_experience_orb': {
        const e = spawnCommon(a.entityId, 'experience_orb', a.x, a.y, a.z, 0, 0, 0);
        attachRecord(e, k);
        e.rec.meta.count = a.count;
        e.rec.keys.push({ k, pos: [e.x, e.y, e.z], vel: [0, 0, 0] });
        break;
      }
      case 'entity_destroy':
        for (const id of a.entityIds) {
          const e = ents.get(id);
          if (e?.bot && live) bots.get(e.bot).events.push([k, 'despawn']);
          destroy(id, k);
        }
        break;
      case 'rel_entity_move':
      case 'entity_move_look':
      case 'entity_look': {
        const e = ents.get(a.entityId);
        if (!e) break;
        let pos = null;
        if (p.name !== 'entity_look') {
          e.px += a.dX; e.py += a.dY; e.pz += a.dZ;
          pos = packetPos(e);
        }
        const hasRot = p.name !== 'rel_entity_move';
        onMove(e, pos, hasRot ? a.yaw * ANGLE : null, hasRot ? a.pitch * ANGLE : null, k, false);
        e.onGround = a.onGround;
        break;
      }
      case 'entity_teleport': {
        const e = ents.get(a.entityId);
        if (!e) break;
        e.px = Math.round(a.x * 4096); e.py = Math.round(a.y * 4096); e.pz = Math.round(a.z * 4096);
        onMove(e, [a.x, a.y, a.z], a.yaw * ANGLE, a.pitch * ANGLE, k, true);
        e.onGround = a.onGround;
        break;
      }
      case 'entity_head_rotation': {
        const e = ents.get(a.entityId);
        if (!e) break;
        e.headLerp = { v: a.headYaw * ANGLE, steps: 3 };
        e.headKnown = true;
        break;
      }
      case 'entity_velocity': {
        const e = ents.get(a.entityId);
        if (!e) break;
        e.vel = [a.velocity.x / 8000, a.velocity.y / 8000, a.velocity.z / 8000];
        if (e.rec && !e.living) {
          const last = e.rec.keys[e.rec.keys.length - 1];
          if (last && last.k === k) last.vel = [...e.vel];
          else e.rec.keys.push({ k, pos: null, vel: [...e.vel] });
        }
        break;
      }
      case 'animation': {
        const e = ents.get(a.entityId);
        const names = ['swing', 'hurt', 'wake', 'swing_offhand', 'crit', 'magic_crit'];
        if (live) emit(e, k, [names[a.animation] ?? `animation_${a.animation}`]);
        break;
      }
      case 'entity_status': {
        const e = ents.get(a.entityId);
        const names = { 2: 'hurt', 3: 'death', 31: 'pull' };
        if (live && names[a.entityStatus]) emit(e, k, [names[a.entityStatus]]);
        break;
      }
      case 'entity_metadata': {
        const e = ents.get(a.entityId);
        if (!e) break;
        for (const m of a.metadata) {
          const prev = e.meta[m.key];
          const value = m.type === 6 ? (m.value?.present ? data.items[m.value.itemId]?.name : null) : m.value;
          e.meta[m.key] = value;
          if (e.rec && e.kind === 'item' && m.key === 7) e.rec.meta.item = value;
          // The full metadata dump right after a spawn is initial state, not an event.
          if (!live || prev === value || (prev === undefined && e.spawnTick === k)) continue;
          if (m.key === 0) {
            const was = prev ?? 0;
            if ((was ^ value) & 0x02) emit(e, k, ['sneak', value & 0x02 ? 1 : 0]);
            if ((was ^ value) & 0x08) emit(e, k, ['sprint', value & 0x08 ? 1 : 0]);
          } else if (m.key === 6) emit(e, k, ['pose', value]);
          else if (m.key === 8 && e.kind === 'fishing_bobber') emit(e, k, ['bite', value ? 1 : 0]);
          else if (m.key === 8 && e.living) emit(e, k, ['health', Math.round(value * 10) / 10]);
        }
        if (e.rec && e.meta[8] !== undefined && e.living && e.rec.meta.health === undefined) e.rec.meta.health = e.meta[8];
        break;
      }
      case 'entity_equipment': {
        const e = ents.get(a.entityId);
        if (!e) break;
        for (const q of a.equipments) {
          const item = q.item?.present ? data.items[q.item.itemId]?.name ?? null : null;
          if (e.equip[q.slot] === item) continue;
          e.equip[q.slot] = item;
          if (e.bot) bots.get(e.bot).events.push([live ? k : 0, 'equip', q.slot, item]);
        }
        break;
      }
      case 'map_chunk':
      case 'block_change':
      case 'multi_block_change': {
        const changes = world.apply(p.name, a);
        if (live) for (const c of changes) blockChanges.push({ k, ...c });
        break;
      }
      case 'block_break_animation': {
        const { x, y, z } = a.location;
        if (live && world.contains(x, y, z)) cracks.push({ k, x, y, z, stage: a.destroyStage, by: botOf(a.entityId) });
        break;
      }
      case 'world_event': {
        const { x, y, z } = a.location;
        if (live && world.contains(x, y, z)) effects.push({ k, type: 'event', id: a.effectId, data: a.data, pos: [x + 0.5, y + 0.5, z + 0.5] });
        break;
      }
      case 'world_particles': {
        if (!live || !world.contains(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z))) break;
        effects.push({
          k, type: 'particle', name: data.particles[a.particleId]?.name ?? `particle_${a.particleId}`,
          pos: [a.x, a.y, a.z], offset: [a.offsetX, a.offsetY, a.offsetZ], speed: a.particleData, count: a.particles,
        });
        break;
      }
      case 'sound_effect': {
        const pos = [a.x / 8, a.y / 8, a.z / 8];
        if (!live || !world.contains(Math.floor(pos[0]), Math.floor(pos[1]), Math.floor(pos[2]))) break;
        const name = data.sounds[a.soundId]?.name ?? `sound_${a.soundId}`;
        const dup = effects.find((f) => f.k === k && f.type === 'sound' && f.id === a.soundId && f.pos.every((v, i) => v === pos[i]));
        if (!dup) effects.push({ k, type: 'sound', id: a.soundId, name, pos, volume: a.volume, pitch: a.pitch });
        break;
      }
      case 'collect': {
        const e = ents.get(a.collectedEntityId);
        if (live && e?.rec) e.rec.events.push([k, 'collect', botOf(a.collectorEntityId) ?? `#${a.collectorEntityId}`]);
        break;
      }
      default:
        break;
    }
  }
  finishTick(tick);
  const ticks = tick + 1;
  for (const r of records) if (r.despawn === null) r.despawn = ticks;

  // Non-living entities: smooth their path through the sparse server keyframes.
  for (const r of records) {
    if (r.keys.length === 0) continue;
    r.samples = sampleKeyframes(r, PHYSICS[r.kind] ?? PHYSICS.default);
  }
  const entities = records.filter((r) => r.samples.length > 0);
  return { ticks, bots: [...bots.values()], entities, blockChanges, cracks, effects, initialWorld, finalWorld: world, skipped };
}

// Cubic Hermite between position keyframes (tangents from velocity), ballistic after the last one.
function sampleKeyframes(r, [gravity, drag]) {
  const n = r.despawn - r.spawn;
  const keys = [];
  let vel = [0, 0, 0];
  for (const key of r.keys) {
    if (key.vel) vel = key.vel;
    if (key.pos) keys.push({ k: key.k, pos: key.pos, vel: [...vel] });
    else if (keys.length) keys.push({ k: key.k, pos: null, vel: [...vel] });
  }
  const posKeys = keys.filter((q) => q.pos);
  const out = [];
  let ki = 0;
  let cur = null;
  let curVel = null;
  for (let i = 0; i < n; i++) {
    const k = r.spawn + i;
    while (ki + 1 < posKeys.length && posKeys[ki + 1].k <= k) ki++;
    const k0 = posKeys[ki];
    const k1 = posKeys[ki + 1];
    let pos;
    if (k0.k > k) pos = k0.pos;
    else if (k1) {
      const dt = k1.k - k0.k;
      const s = (k - k0.k) / dt;
      const s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      pos = [0, 1, 2].map((j) => h00 * k0.pos[j] + h10 * dt * k0.vel[j] + h01 * k1.pos[j] + h11 * dt * k1.vel[j]);
      cur = null;
    } else {
      if (!cur || k === k0.k) { cur = [...k0.pos]; curVel = [...k0.vel]; }
      else {
        const vk = keys.find((q) => !q.pos && q.k === k);
        if (vk) curVel = [...vk.vel];
        for (let j = 0; j < 3; j++) cur[j] += curVel[j];
        curVel[1] -= gravity;
        for (let j = 0; j < 3; j++) curVel[j] *= drag;
      }
      pos = [...cur];
    }
    const rot = r.samples[i] ?? r.samples[r.samples.length - 1];
    out.push([pos[0], pos[1], pos[2], rot?.[3] ?? 0, rot?.[4] ?? 0, rot?.[5] ?? 0]);
  }
  return out;
}
