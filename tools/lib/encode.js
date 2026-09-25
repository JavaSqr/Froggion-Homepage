// Cuts one bot's loop out of a simulated replay and packs it into compact JSON.

export const POS_SCALE = 64; // 1/64 block
export const ANGLE_SCALE = 1024; // units per full turn
const SOUNDS = new Set(['entity.fishing_bobber.splash', 'entity.generic.splash']);
const PICKUP_RADIUS = 2.5;

const round3 = (v) => Math.round(v * 1000) / 1000;

export class Palette {
  constructor(reg) {
    this.reg = reg;
    this.list = [];
    this.map = new Map();
  }
  index(stateId) {
    const s = this.reg.isTechnical(stateId) ? 'air' : this.reg.stateString(stateId);
    let i = this.map.get(s);
    if (i === undefined) { i = this.list.length; this.list.push(s); this.map.set(s, i); }
    return i;
  }
}

function deltaCode(values) {
  const out = new Array(values.length);
  let prev = 0;
  for (let i = 0; i < values.length; i++) { out[i] = values[i] - prev; prev = values[i]; }
  return out;
}

function angleCode(values) {
  const q = values.map((v) => Math.round((v * ANGLE_SCALE) / 360));
  const out = new Array(q.length);
  let prev = 0;
  for (let i = 0; i < q.length; i++) {
    let d = (q[i] - prev) % ANGLE_SCALE;
    if (d >= ANGLE_SCALE / 2) d -= ANGLE_SCALE;
    if (d < -ANGLE_SCALE / 2) d += ANGLE_SCALE;
    out[i] = d;
    prev += d;
  }
  return out;
}

export function encodeTrack(samples, origin, withAngles = true) {
  const t = {};
  ['x', 'y', 'z'].forEach((axis, j) => { t[axis] = deltaCode(samples.map((s) => Math.round((s[j] - origin[j]) * POS_SCALE))); });
  if (withAngles) ['yaw', 'pitch', 'head'].forEach((axis, j) => { t[axis] = angleCode(samples.map((s) => s[3 + j])); });
  return t;
}

const local = (p, origin) => p.map((v, i) => Math.round((v - origin[i]) * POS_SCALE));

export function encodeBotLoop({ sim, zone, loop, origin, palette, dynamic }) {
  const { from, to } = loop;
  const len = to - from;
  const bot = sim.bots.find((b) => b.nick === zone.nick);
  const inLoop = (k) => k >= from && k < to;

  // Player track; ticks without the bot (rejoin gaps) hold the last known sample.
  let last = bot.samples[from];
  const hidden = [];
  const samples = [];
  for (let k = from; k < to; k++) {
    const s = bot.samples[k];
    if (s) last = s;
    else if (!hidden.length || hidden[hidden.length - 1][1] !== k - from) hidden.push([k - from, k - from + 1]);
    else hidden[hidden.length - 1][1]++;
    samples.push(last);
  }

  // Events: state-like ones before the loop collapse into tick 0.
  const events = [];
  const state = new Map();
  for (const e of bot.events) {
    const [k, type] = e;
    if (k < from) {
      if (type === 'equip') state.set(`equip${e[2]}`, e);
      else if (type === 'sneak' || type === 'sprint' || type === 'pose' || type === 'health') state.set(type, e);
      continue;
    }
    if (!inLoop(k)) continue;
    if (type === 'spawn' || type === 'despawn') continue;
    events.push([k - from, ...e.slice(1)]);
  }
  const initial = [...state.values()].map((e) => [0, ...e.slice(1)]);
  const equipNow = new Map();
  const merged = [];
  for (const e of [...initial, ...events]) {
    if (e[1] === 'equip') {
      if (equipNow.get(e[2]) === e[3]) continue;
      equipNow.set(e[2], e[3]);
    }
    merged.push(e);
  }

  // Blocks: every dynamic position of the zone starts in its state at `from`.
  const stateAt = (pos, k) => {
    let cur = sim.initialWorld.get(...pos);
    for (const c of sim.blockChanges) {
      if (c.k > k) break;
      if (c.x === pos[0] && c.y === pos[1] && c.z === pos[2]) cur = c.state;
    }
    return cur;
  };
  const toLocal = (x, y, z) => [x - origin[0], y - origin[1], z - origin[2]];
  const init = dynamic.map((pos) => [...toLocal(...pos), palette.index(stateAt(pos, from))]);
  const dynKeys = new Set(dynamic.map((p) => p.join(',')));
  const changes = sim.blockChanges
    .filter((c) => inLoop(c.k) && c.k > from && dynKeys.has(`${c.x},${c.y},${c.z}`))
    .map((c) => [c.k - from, ...toLocal(c.x, c.y, c.z), palette.index(c.state)]);

  const cracks = zone.cracks.filter((c) => inLoop(c.k)).map((c) => [c.k - from, ...toLocal(c.x, c.y, c.z), c.stage > 9 ? 9 : c.stage]);

  const effects = [];
  for (const e of zone.effects) {
    if (!inLoop(e.k)) continue;
    const k = e.k - from;
    if (e.type === 'event') {
      const p = e.pos.map((v, i) => Math.floor(v) - origin[i]);
      if (e.id === 2001) effects.push([k, 'break', ...p, palette.index(e.data)]);
      else if (e.id === 1501) effects.push([k, 'fizz', ...p]);
      else effects.push([k, 'event', e.id, ...p, e.data]);
    } else if (e.type === 'particle') {
      effects.push([k, 'particle', e.name, ...local(e.pos, origin), e.count, ...e.offset.map(round3), round3(e.speed)]);
    } else if (e.type === 'sound' && SOUNDS.has(e.name)) {
      effects.push([k, 'sound', e.name, ...local(e.pos, origin), round3(e.volume)]);
    }
  }

  const entities = [];
  for (const r of zone.entities) {
    const a = Math.max(r.spawn, from), b = Math.min(r.despawn, to);
    if (a >= b) continue;
    const ent = { kind: r.kind, from: a - from, to: b - from };
    if (r.meta.item) ent.item = r.meta.item;
    if (r.meta.count) ent.count = r.meta.count;
    if (r.spawn < from) ent.present = true;
    if (r.despawn > to) ent.persists = true;
    const living = r.kind !== 'item' && r.kind !== 'experience_orb' && r.kind !== 'fishing_bobber';
    ent.track = encodeTrack(r.samples.slice(a - r.spawn, b - r.spawn), origin, living);
    const evs = [];
    let health = r.meta.health, dead = false, bite = 0;
    for (const e of r.events) {
      if (e[0] < from) {
        if (e[1] === 'health') health = e[2];
        if (e[1] === 'death') dead = true;
        if (e[1] === 'bite') bite = e[2];
        continue;
      }
      if (inLoop(e[0])) evs.push([e[0] - from, ...e.slice(1)]);
    }
    if (health !== undefined && living) ent.health = health;
    if (dead) ent.dead = true;
    if (bite) ent.bite = 1;
    // No collect packet in the recording: a pickup is an item vanishing next to the bot.
    if ((r.kind === 'item' || r.kind === 'experience_orb') && inLoop(r.despawn) && !r.events.some((e) => e[1] === 'collect')) {
      const end = r.samples[r.samples.length - 1];
      const home = samples[Math.min(r.despawn - from, len - 1)];
      if (Math.hypot(end[0] - home[0], end[1] - (home[1] + 0.8), end[2] - home[2]) < PICKUP_RADIUS) evs.push([r.despawn - from, 'collect', zone.nick, 'inferred']);
    }
    if (evs.length) ent.events = evs;
    entities.push(ent);
  }

  const zoneBox = boxOf([
    ...samples.map((s) => s.slice(0, 3)),
    ...dynamic.map((p) => [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5]),
    ...zone.entities.flatMap((r) => r.samples.map((s) => s.slice(0, 3))),
  ], origin);

  const out = {
    nick: zone.nick,
    source: { replay: loop.replay, from, to },
    length: len,
    home: local(zone.home, origin),
    zone: zoneBox,
    track: encodeTrack(samples, origin),
    events: merged,
    blocks: { init, changes },
    cracks,
    effects,
    entities,
  };
  if (hidden.length) out.hidden = hidden;
  return out;
}

function boxOf(points, origin) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  return { min: min.map((v, i) => Math.floor(v - origin[i])), max: max.map((v, i) => Math.ceil(v - origin[i])) };
}
