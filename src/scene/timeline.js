// Decodes public/data/scene.json into per-bot loops and steps them tick by tick.
export const TICKS_PER_SECOND = 20;

function decodeTrack(t, posScale, angleScale) {
  const out = {};
  for (const [k, arr] of Object.entries(t)) {
    const angle = k === 'yaw' || k === 'pitch' || k === 'head';
    const f = new Float32Array(arr.length);
    let acc = 0;
    for (let i = 0; i < arr.length; i++) { acc += arr[i]; f[i] = angle ? (acc * 360) / angleScale : acc / posScale; }
    out[k] = f;
  }
  return out;
}

// Groups [tick, ...] records by tick for O(1) lookup while playing.
function byTick(list, length) {
  const m = new Map();
  for (const e of list ?? []) {
    const k = Math.min(e[0], length - 1);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return m;
}

export function decodeScene(data) {
  const { posScale, angleScale, palette } = data;
  const P = (v) => v / posScale;
  return {
    origin: data.origin,
    palette,
    bots: data.bots.map((b) => {
      const length = b.length;
      const effects = (b.effects ?? []).map((e) => {
        if (e[1] === 'particle') return { tick: e[0], type: 'particle', name: e[2], pos: [P(e[3]), P(e[4]), P(e[5])], count: e[6], offset: [e[7], e[8], e[9]], speed: e[10] };
        if (e[1] === 'break') return { tick: e[0], type: 'break', block: [e[2], e[3], e[4]], state: palette[e[5]] };
        if (e[1] === 'fizz') return { tick: e[0], type: 'fizz', block: [e[2], e[3], e[4]] };
        if (e[1] === 'sound') return { tick: e[0], type: 'sound', name: e[2], pos: [P(e[3]), P(e[4]), P(e[5])], volume: e[6] };
        return { tick: e[0], type: e[1], raw: e };
      });
      return {
        nick: b.nick,
        job: b.job,
        length,
        home: b.home.map(P),
        zone: b.zone,
        track: decodeTrack(b.track, posScale, angleScale),
        hidden: b.hidden ?? [],
        events: byTick(b.events, length),
        initial: (b.events ?? []).filter((e) => e[0] === 0),
        blocksInit: b.blocks.init.map(([x, y, z, p]) => [x, y, z, palette[p]]),
        blockChanges: byTick(b.blocks.changes.map(([t, x, y, z, p]) => [t, x, y, z, palette[p]]), length),
        cracks: byTick(b.cracks, length),
        effects: byTick(effects.map((e) => [e.tick, e]), length),
        entities: (b.entities ?? []).map((e, i) => ({
          id: `${b.nick}:${i}`,
          kind: e.kind,
          item: e.item ?? null,
          count: e.count ?? 0,
          from: e.from,
          to: e.to,
          present: !!e.present,
          persists: !!e.persists,
          health: e.health ?? null,
          dead: !!e.dead,
          bite: !!e.bite,
          track: decodeTrack(e.track, posScale, angleScale),
          events: byTick(e.events, length),
        })),
      };
    }),
  };
}

export function sampleTrack(track, i) {
  return [track.x[i], track.y[i], track.z[i], track.yaw?.[i] ?? 0, track.pitch?.[i] ?? 0, track.head?.[i] ?? 0];
}

/**
 * One bot's loop. `handlers` receives world-side effects:
 *   reset(bot), tick(bot, k), block(x, y, z, state), crack(x, y, z, stage),
 *   effect(e), spawn(entity), despawn(entity, k), entityEvent(entity, event), botEvent(event)
 * The playhead advances in ticks; at the end of the loop the zone snaps back to its start state.
 */
export class BotLoop {
  constructor(bot, handlers, startTick = 0) {
    this.bot = bot;
    this.h = handlers;
    this.tick = -1;
    this.time = startTick;
    this.alive = new Map();
  }

  restart(k) {
    const b = this.bot;
    for (const e of this.alive.values()) this.h.despawn(e, k, true);
    this.alive.clear();
    this.h.reset(b);
    for (const [x, y, z, s] of b.blocksInit) this.h.block(x, y, z, s);
    for (const e of b.initial) this.h.botEvent(e);
  }

  step(k) {
    const b = this.bot;
    if (k === 0) this.restart(k);
    for (const [, x, y, z, s] of b.blockChanges.get(k) ?? []) this.h.block(x, y, z, s);
    for (const [, x, y, z, stage] of b.cracks.get(k) ?? []) this.h.crack(x, y, z, stage);
    for (const e of b.events.get(k) ?? []) if (k > 0 || e[0] !== 0) this.h.botEvent(e);
    for (const ent of b.entities) {
      if (ent.from === k) { this.alive.set(ent.id, ent); this.h.spawn(ent, k); }
      if (this.alive.has(ent.id)) for (const ev of ent.events.get(k) ?? []) this.h.entityEvent(ent, ev);
      if (ent.to === k && this.alive.has(ent.id)) { this.alive.delete(ent.id); this.h.despawn(ent, k, false); }
    }
    for (const [, e] of b.effects.get(k) ?? []) this.h.effect(e);
    this.h.tick(b, k);
  }

  // Advances by `dt` seconds; returns the partial tick for interpolation.
  advance(dt) {
    this.time += dt * TICKS_PER_SECOND;
    const len = this.bot.length;
    while (this.tick + 1 <= Math.floor(this.time)) {
      this.tick++;
      this.step(this.tick % len);
    }
    return this.time - Math.floor(this.time);
  }

  get loopTick() {
    return ((this.tick % this.bot.length) + this.bot.length) % this.bot.length;
  }
}
