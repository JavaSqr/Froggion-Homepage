// Splits a simulated replay into per-bot zones and finds loop boundaries where the zone state repeats.

const wrapDeg = (a) => {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
};

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export function botHome(bot) {
  const s = bot.samples.filter(Boolean);
  return [0, 1, 2].map((j) => median(s.map((v) => v[j])));
}

// Every entity, dynamic block, crack and effect goes to the bot whose station is nearest.
export function assignZones(sim) {
  const homes = new Map(sim.bots.filter((b) => b.samples.some(Boolean)).map((b) => [b.nick, botHome(b)]));
  const nearest = (x, z) => {
    let best = null, bd = Infinity;
    for (const [nick, h] of homes) {
      const d = (h[0] - x) ** 2 + (h[2] - z) ** 2;
      if (d < bd) { bd = d; best = nick; }
    }
    return best;
  };
  const zones = new Map([...homes.keys()].map((n) => [n, { nick: n, home: homes.get(n), entities: [], blocks: [], cracks: [], effects: [] }]));
  for (const r of sim.entities) {
    const owner = r.owner && zones.has(r.owner) ? r.owner : nearest(r.samples[0][0], r.samples[0][2]);
    zones.get(owner)?.entities.push(r);
  }
  const positions = new Map();
  for (const c of sim.blockChanges) positions.set(`${c.x},${c.y},${c.z}`, [c.x, c.y, c.z]);
  for (const [key, p] of positions) zones.get(nearest(p[0] + 0.5, p[2] + 0.5)).blocks.push({ key, pos: p });
  for (const c of sim.cracks) zones.get(c.by && zones.has(c.by) ? c.by : nearest(c.x + 0.5, c.z + 0.5)).cracks.push(c);
  for (const e of sim.effects) zones.get(nearest(e.pos[0], e.pos[2])).effects.push(e);
  return zones;
}

// Per-tick snapshot of everything that matters for a seamless loop.
export function zoneTimeline(sim, zone) {
  const n = sim.ticks;
  const bot = sim.bots.find((b) => b.nick === zone.nick);
  const blockState = zone.blocks.map((b) => {
    const arr = new Int32Array(n);
    let cur = sim.initialWorld.get(...b.pos);
    const changes = sim.blockChanges.filter((c) => `${c.x},${c.y},${c.z}` === b.key);
    let ci = 0;
    for (let k = 0; k < n; k++) {
      while (ci < changes.length && changes[ci].k <= k) cur = changes[ci++].state;
      arr[k] = cur;
    }
    return arr;
  });
  const crackKeys = [...new Set(zone.cracks.map((c) => `${c.x},${c.y},${c.z}`))];
  const crackState = crackKeys.map((key) => {
    const arr = new Int8Array(n).fill(-1);
    const list = zone.cracks.filter((c) => `${c.x},${c.y},${c.z}` === key);
    let cur = -1, ci = 0;
    const block = zone.blocks.findIndex((b) => b.key === key);
    for (let k = 0; k < n; k++) {
      while (ci < list.length && list[ci].k <= k) { const s = list[ci++].stage; cur = s >= 0 && s <= 9 ? s : s > 9 ? 9 : -1; }
      if (block >= 0 && k > 0 && blockState[block][k] !== blockState[block][k - 1]) cur = -1;
      arr[k] = cur;
    }
    return arr;
  });
  const swingAge = new Int16Array(n).fill(99);
  let last = -99;
  const swings = new Set(bot.events.filter((e) => e[1] === 'swing').map((e) => e[0]));
  for (let k = 0; k < n; k++) {
    if (swings.has(k)) last = k;
    swingAge[k] = Math.min(99, k - last);
  }
  const entityState = (k) => zone.entities.filter((r) => r.spawn <= k && k < r.despawn).map((r) => {
    const s = r.samples[k - r.spawn];
    let health = r.meta.health ?? null, dead = false, bite = 0;
    for (const e of r.events) {
      if (e[0] > k) break;
      if (e[1] === 'health') health = e[2];
      if (e[1] === 'death') dead = true;
      if (e[1] === 'bite') bite = e[2];
    }
    return { kind: r.kind, item: r.meta.item ?? null, pos: s, health, dead, bite, age: k - r.spawn };
  });
  const entities = Array.from({ length: n }, (_, k) => entityState(k));
  return { bot, blockState, crackState, swingAge, entities, ticks: n };
}

// Cost of the jump from the state at the loop end to the state at the loop start.
// Crop growth by a stage or two reads as normal growth; anything else is a visible pop.
function blockCost(reg, from, to) {
  if (from === to) return 0;
  const sf = reg.stateString(from), st = reg.stateString(to);
  const mf = /^(\w+)\[age=(\d+)\]$/.exec(sf), mt = /^(\w+)\[age=(\d+)\]$/.exec(st);
  if (mf && mt && mf[1] === mt[1]) {
    const d = mt[2] - mf[2];
    return d > 0 && d <= 2 ? 0.3 * d : 1 + Math.abs(d) / 4;
  }
  return 3;
}

function entityCost(ea, eb) {
  let cost = 0;
  const used = new Set();
  for (const a of ea) {
    let best = -1, bc = Infinity;
    eb.forEach((b, i) => {
      if (used.has(i) || b.kind !== a.kind) return;
      const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
      const c = d * 3 + Math.abs((a.health ?? 0) - (b.health ?? 0)) / 4 + (a.dead !== b.dead ? 3 : 0) + (a.bite !== b.bite ? 2 : 0) + Math.min(Math.abs(a.age - b.age), 40) / 20;
      if (c < bc) { bc = c; best = i; }
    });
    if (best < 0) cost += 5;
    else { used.add(best); cost += bc; }
  }
  cost += (eb.length - used.size) * 5;
  return cost;
}

export function loopCost(reg, tl, a, b) {
  const sa = tl.bot.samples[a], sb = tl.bot.samples[b];
  if (!sa || !sb) return { total: Infinity };
  const pose = Math.hypot(sa[0] - sb[0], sa[1] - sb[1], sa[2] - sb[2]) * 10
    + (Math.abs(wrapDeg(sa[3] - sb[3])) + Math.abs(sa[4] - sb[4]) + Math.abs(wrapDeg(sa[5] - sb[5]))) / 10;
  const pa = tl.bot.samples[a - 1] ?? sa, pb = tl.bot.samples[b - 1] ?? sb;
  const motion = Math.abs(wrapDeg(sa[3] - pa[3]) - wrapDeg(sb[3] - pb[3])) / 10;
  const swing = Math.min(tl.swingAge[a], 8) !== Math.min(tl.swingAge[b], 8) ? 2 : 0;
  let blocks = 0;
  for (const arr of tl.blockState) blocks += blockCost(reg, arr[b], arr[a]);
  let cracks = 0;
  for (const arr of tl.crackState) cracks += arr[a] !== arr[b] ? 1 : 0;
  const entities = entityCost(tl.entities[a], tl.entities[b]);
  const total = pose + motion + swing + blocks + cracks + entities;
  return { total, pose, motion, swing, blocks, cracks, entities };
}

// Candidate loops [from, to): the state at `to` should match the state at `from`.
export function loopCandidates(reg, tl, { minTicks = 100, maxTicks = Infinity, count = 5 } = {}) {
  const n = tl.ticks;
  const present = (k) => !!tl.bot.samples[k];
  const all = [];
  for (let a = 1; a < n; a++) {
    if (!present(a)) continue;
    for (let b = a + minTicks; b < n && b - a <= maxTicks; b++) {
      if (!present(b)) continue;
      const c = loopCost(reg, tl, a, b);
      // Prefer longer loops a little: more variety before the cut repeats.
      all.push({ from: a, to: b, cost: c.total, score: c.total - (b - a) / 200, detail: c });
    }
  }
  all.sort((x, y) => x.score - y.score);
  const picked = [];
  for (const c of all) {
    if (picked.some((p) => Math.abs(p.from - c.from) < 20 && Math.abs(p.to - c.to) < 20)) continue;
    picked.push(c);
    if (picked.length >= count) break;
  }
  return picked;
}
