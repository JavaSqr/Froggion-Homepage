// Runtime of the island: each bot plays its own loop and owns the entities, blocks and effects of its zone.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial,
  Sprite, SpriteMaterial, Vector3,
} from 'three';
import { BotLoop, sampleTrack } from './timeline.js';
import { Humanoid } from './humanoid.js';
import { Creeper } from './creeper.js';
import { handTransform, GROUND, spriteTexture } from './items.js';
import { modelFor } from './blocks.js';
import { wrapDegrees, rotLerp, lerp, DEG } from './model.js';

const SWING_DURATION = 6;
const EYE_HEIGHT = 1.62;

// Client-side state of a living entity, advanced once per tick like LivingEntity.tick().
class Living {
  constructor(s) {
    this.set(s);
    this.xo = this.x; this.yo = this.y; this.zo = this.z;
    this.yRotO = this.yRot; this.xRotO = this.xRot; this.yHeadRotO = this.yHeadRot;
    this.yBodyRot = this.yRot; this.yBodyRotO = this.yRot;
    this.attackAnim = 0; this.oAttackAnim = 0; this.swinging = false; this.swingTime = 0;
    this.animationSpeed = 0; this.animationSpeedOld = 0; this.animationPosition = 0;
    this.tickCount = 0; this.hurtTime = 0; this.deathTime = 0; this.dead = false;
  }

  set(s) {
    [this.x, this.y, this.z, this.yRot, this.xRot, this.yHeadRot] = s;
  }

  swing() {
    if (!this.swinging || this.swingTime >= SWING_DURATION / 2 || this.swingTime < 0) {
      this.swingTime = -1;
      this.swinging = true;
    }
  }

  tick(s) {
    this.xo = this.x; this.yo = this.y; this.zo = this.z;
    this.yRotO = this.yRot; this.xRotO = this.xRot; this.yHeadRotO = this.yHeadRot; this.yBodyRotO = this.yBodyRot;
    this.oAttackAnim = this.attackAnim; this.animationSpeedOld = this.animationSpeed;
    // Keep angles continuous so interpolation takes the short way.
    this.x = s[0]; this.y = s[1]; this.z = s[2];
    this.yRot = this.yRotO + wrapDegrees(s[3] - this.yRotO);
    this.xRot = s[4];
    this.yHeadRot = this.yHeadRotO + wrapDegrees(s[5] - this.yHeadRotO);
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.dead) this.deathTime++;
    // updateSwingTime
    if (this.swinging) {
      this.swingTime++;
      if (this.swingTime >= SWING_DURATION) { this.swingTime = 0; this.swinging = false; }
    } else this.swingTime = 0;
    this.attackAnim = this.swingTime / SWING_DURATION;
    // Body follows movement, then lags behind the look direction (tickHeadTurn).
    const dx = this.x - this.xo, dz = this.z - this.zo;
    const f = dx * dx + dz * dz;
    let target = this.yBodyRot;
    if (f > 0.0025000002) {
      const f4 = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
      const f5 = Math.abs(wrapDegrees(this.yRot) - f4);
      target = f5 > 95 && f5 < 265 ? f4 - 180 : f4;
    }
    if (this.attackAnim > 0) target = this.yRot;
    this.yBodyRot += wrapDegrees(target - this.yBodyRot) * 0.3;
    let d = wrapDegrees(this.yRot - this.yBodyRot);
    if (d < -75) d = -75;
    if (d >= 75) d = 75;
    this.yBodyRot = this.yRot - d;
    if (d * d > 2500) this.yBodyRot += d * 0.2;
    // Walk animation
    const dist = Math.min(1, Math.sqrt(f) * 4);
    this.animationSpeed += (dist - this.animationSpeed) * 0.4;
    this.animationPosition += this.animationSpeed;
    this.tickCount++;
  }

  pose(pt) {
    let a = this.attackAnim - this.oAttackAnim;
    if (a < 0) a += 1;
    const body = rotLerp(pt, this.yBodyRotO, this.yBodyRot);
    const head = rotLerp(pt, this.yHeadRotO, this.yHeadRot);
    return {
      x: lerp(pt, this.xo, this.x), y: lerp(pt, this.yo, this.y), z: lerp(pt, this.zo, this.z),
      bodyYaw: body,
      netHeadYaw: wrapDegrees(head - body),
      headPitch: lerp(pt, this.xRotO, this.xRot),
      attackTime: this.oAttackAnim + a * pt,
      limbSwing: this.animationPosition - this.animationSpeed * (1 - pt),
      limbSwingAmount: Math.min(1, lerp(pt, this.animationSpeedOld, this.animationSpeed)),
      ageInTicks: this.tickCount + pt,
      hurt: this.hurtTime > 0 || this.deathTime > 0 ? 1 : 0,
      death: this.deathTime > 0 ? Math.min(1, Math.sqrt(((this.deathTime + pt - 1) / 20) * 1.6)) : 0,
    };
  }
}

export class World {
  constructor({ scene, island, decoded, meta, assets, particles, items, lite, lit = false }) {
    this.scene = scene;
    // Night: entities take the light of the cell they are in.
    this.lit = lit;
    this.island = island;
    this.particles = particles;
    this.items = items;
    this.assets = assets;
    this.lite = lite;
    this.root = new Group();
    this.root.name = 'actors';
    scene.add(this.root);
    this.cracks = new Map();
    this.pickups = [];
    this.crackMaterials = assets.destroy.map((t) => new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.crackGeometry = new BoxGeometry(1.004, 1.004, 1.004);
    this.bobberMaterial = new SpriteMaterial({ map: spriteTexture(assets.images.get('entity/fishing_bobber')), transparent: false, alphaTest: 0.5 });
    this.orbMaterial = new SpriteMaterial({ map: spriteTexture(assets.images.get('entity/experience_orb')), alphaTest: 0.5 });
    this.lineMaterial = new LineBasicMaterial({ color: 0x000000 });
    this.bots = decoded.bots.map((b) => this.createBot(b, meta.find((m) => m.nick === b.nick)));
  }

  createBot(data, meta) {
    const model = new Humanoid({ skin: this.assets.skins.get(data.nick), slim: meta?.model === 'slim' });
    model.entity.userData.nick = data.nick;
    for (const m of model.pickables) m.userData.nick = data.nick;
    castShadows(model.entity);
    // Where the name tag goes; drawn as HTML over the canvas (nametags.js).
    const tag = { position: new Vector3(), visible: true };
    this.root.add(model.entity);
    const bot = {
      data, meta, model, tag,
      living: new Living(sampleTrack(data.track, 0)),
      equip: {},
      heldName: null,
      crouching: false,
      entities: new Map(),
      loop: null,
      pt: 0,
      nick: data.nick,
    };
    bot.loop = new BotLoop(data, this.handlers(bot));
    return bot;
  }

  handlers(bot) {
    const w = this;
    return {
      reset() {
        for (const [key, m] of w.cracks) if (m.userData.owner === bot.nick) { w.root.remove(m); w.cracks.delete(key); }
      },
      tick(data, k) {
        bot.living.tick(sampleTrack(data.track, k));
        bot.hidden = data.hidden.some(([a, b]) => k >= a && k < b);
        for (const e of bot.entities.values()) w.tickEntity(e, k);
      },
      block(x, y, z, state) {
        w.island.setBlock(x, y, z, state);
        w.setCrack(bot, x, y, z, -1);
      },
      crack(x, y, z, stage) { w.setCrack(bot, x, y, z, stage); },
      effect(e) { w.effect(e); },
      spawn(ent, k) { w.spawnEntity(bot, ent, k); },
      despawn(ent, k, forced) { w.despawnEntity(bot, ent, forced); },
      entityEvent(ent, ev) { w.entityEvent(bot, ent, ev); },
      botEvent(e) {
        const type = e[1];
        if (type === 'swing') bot.living.swing();
        else if (type === 'equip') bot.equip[e[2]] = e[3];
        else if (type === 'sneak') bot.crouching = !!e[2];
      },
    };
  }

  setCrack(bot, x, y, z, stage) {
    const key = `${x},${y},${z}`;
    let m = this.cracks.get(key);
    if (stage < 0 || stage > 9) {
      if (m) { this.root.remove(m); this.cracks.delete(key); }
      return;
    }
    if (!m) {
      m = new Mesh(this.crackGeometry, this.crackMaterials[stage]);
      m.position.set(x + 0.5, y + 0.5, z + 0.5);
      m.userData.owner = bot.nick;
      m.renderOrder = 1;
      this.root.add(m);
      this.cracks.set(key, m);
    }
    m.material = this.crackMaterials[stage];
  }

  effect(e) {
    const p = this.particles;
    if (e.type === 'particle') p.spawnPacket(e.name, e.pos, e.count, e.offset, e.speed);
    else if (e.type === 'break') {
      const m = modelFor(e.state);
      const tex = m.kind === 'crop' || m.kind === 'cross' ? m.tex : m.kind === 'cube' ? m.tex.north : m.boxes?.[0]?.tex.north;
      if (tex) p.blockBreak(e.block, tex, [[0, 0, 0], [1, 1, 1]], this.lite ? 2 : 4);
    } else if (e.type === 'fizz') {
      for (let i = 0; i < 8; i++) p.spawn('large_smoke', [e.block[0] + Math.random(), e.block[1] + 1.2, e.block[2] + Math.random()]);
    }
  }

  spawnEntity(bot, ent) {
    const s = sampleTrack(ent.track, 0);
    const e = { ent, kind: ent.kind, prev: s, cur: s, age: 0, object: null, bot };
    if (ent.kind === 'creeper') {
      const c = new Creeper({ texture: this.assets.creeper });
      e.model = c;
      e.living = new Living(s);
      e.living.dead = ent.dead;
      e.object = c.entity;
    } else if (ent.kind === 'fishing_bobber') {
      const sprite = new Sprite(this.bobberMaterial);
      sprite.scale.set(0.3, 0.3, 1);
      e.object = sprite;
      e.line = new Line(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(17 * 3), 3)), this.lineMaterial);
      e.line.frustumCulled = false;
      this.root.add(e.line);
    } else if (ent.kind === 'item') {
      const holder = new Group();
      const obj = this.items.create(ent.item, GROUND);
      if (obj) { const inner = new Group(); inner.scale.setScalar(1 / 16); inner.add(obj); holder.add(inner); e.spin = holder; }
      e.object = holder;
      e.bobOffs = Math.random() * Math.PI * 2;
    } else if (ent.kind === 'experience_orb') {
      const sprite = new Sprite(this.orbMaterial.clone());
      sprite.scale.set(0.3, 0.3, 1);
      e.object = sprite;
    }
    if (e.object) { castShadows(e.object); this.root.add(e.object); }
    bot.entities.set(ent.id, e);
  }

  tickEntity(e, k) {
    const i = Math.max(0, Math.min(k - e.ent.from, e.ent.track.x.length - 1));
    e.prev = e.cur;
    e.cur = sampleTrack(e.ent.track, i);
    e.age++;
    if (e.living) e.living.tick(e.cur);
  }

  entityEvent(bot, ent, ev) {
    const e = bot.entities.get(ent.id);
    if (!e) return;
    const type = ev[1];
    if (type === 'hurt' && e.living) { e.living.hurtTime = 10; e.living.animationSpeed = 1.5; }
    else if (type === 'death' && e.living) e.living.dead = true;
    else if (type === 'collect') e.collect = true;
  }

  despawnEntity(bot, ent, forced) {
    const e = bot.entities.get(ent.id);
    if (!e) return;
    bot.entities.delete(ent.id);
    if (!forced && e.collect && e.object) {
      // Pickup: the item flies into the bot over 3 ticks.
      this.pickups.push({ e, bot, start: bot.loop.time, from: [...e.cur] });
      return;
    }
    this.removeEntityView(e);
    if (!forced && e.kind === 'creeper' && e.living?.dead) {
      for (let i = 0; i < 20; i++) {
        this.particles.spawn('poof', [e.cur[0] + (Math.random() - 0.5) * 0.6, e.cur[1] + Math.random() * 1.7, e.cur[2] + (Math.random() - 0.5) * 0.6], [gauss() * 0.02, gauss() * 0.02, gauss() * 0.02]);
      }
    }
  }

  removeEntityView(e) {
    if (e.object) this.root.remove(e.object);
    if (e.line) { this.root.remove(e.line); e.line.geometry.dispose(); }
  }

  // Rod tip in third person (FishingHookRenderer), from the owner's body yaw.
  rodTip(bot, pt) {
    const p = bot.living.pose(pt);
    const f2 = p.bodyYaw * DEG;
    const d0 = Math.sin(f2), d1 = Math.cos(f2), d2 = 0.35;
    return [p.x - d1 * d2 - d0 * 0.8, p.y + EYE_HEIGHT - 0.45 - (bot.crouching ? 0.1875 : 0), p.z - d0 * d2 + d1 * 0.8];
  }

  render(camera) {
    for (const bot of this.bots) this.renderBot(bot, camera);
    this.renderPickups();
  }

  renderBot(bot) {
    const pt = bot.pt;
    const p = bot.living.pose(pt);
    const m = bot.model;
    m.entity.visible = !bot.hidden;
    bot.tag.visible = !bot.hidden;
    m.entity.position.set(p.x, p.y, p.z);
    m.entity.rotation.y = -p.bodyYaw * DEG;
    const hasBobber = [...bot.entities.values()].some((e) => e.kind === 'fishing_bobber');
    let held = bot.equip[0] ?? null;
    if (held === 'fishing_rod' && hasBobber) held = 'fishing_rod_cast';
    if (held !== bot.heldName) {
      bot.heldName = held;
      const item = held ? this.items.create(held, handTransform(held)) : null;
      if (item) castShadows(item);
      m.setHeldItem(item);
    }
    m.setupAnim({ ...p, crouching: bot.crouching, holdingItem: !!held });
    if (this.lit) {
      const c = this.island.lightColor(p.x, p.y + 1, p.z);
      for (const mat of m.materials) mat.color.setRGB(c[0], c[1], c[2]);
      m.heldItem?.traverse((o) => { if (o.isMesh) o.material.color.setRGB(c[0], c[1], c[2]); });
    }
    bot.tag.position.set(p.x, p.y + (bot.crouching ? 1.5 : 1.8) + 0.5, p.z);
    for (const e of bot.entities.values()) this.renderEntity(bot, e, pt);
  }

  renderEntity(bot, e, pt) {
    const x = lerp(pt, e.prev[0], e.cur[0]), y = lerp(pt, e.prev[1], e.cur[1]), z = lerp(pt, e.prev[2], e.cur[2]);
    if (e.kind === 'creeper') {
      const p = e.living.pose(pt);
      e.object.position.set(p.x, p.y, p.z);
      e.object.rotation.y = -p.bodyYaw * DEG;
      e.model.tilt.rotation.z = -p.death * 90 * DEG;
      e.model.setupAnim(p);
      if (this.lit) { const c = this.island.lightColor(p.x, p.y + 1, p.z); e.model.material.color.setRGB(c[0], c[1], c[2]); }
    } else if (e.kind === 'fishing_bobber') {
      e.object.position.set(x, y + 0.25, z);
      const tip = this.rodTip(bot, pt);
      const hook = [x, y + 0.25, z];
      const f = [tip[0] - hook[0], tip[1] - hook[1], tip[2] - hook[2]];
      const arr = e.line.geometry.attributes.position.array;
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        arr[i * 3] = x + f[0] * t;
        arr[i * 3 + 1] = y + f[1] * (t * t + t) * 0.5 + 0.25;
        arr[i * 3 + 2] = z + f[2] * t;
      }
      e.line.geometry.attributes.position.needsUpdate = true;
    } else if (e.kind === 'item') {
      const age = e.age + pt;
      const bob = Math.sin(age / 10 + e.bobOffs) * 0.1 + 0.1;
      e.object.position.set(x, y + bob + 0.25 * GROUND.scale, z);
      e.object.rotation.y = age / 20 + e.bobOffs;
    } else if (e.kind === 'experience_orb') {
      e.object.position.set(x, y + 0.1, z);
      const f = (e.age + pt) / 2;
      e.object.material.color.setRGB((Math.sin(f) + 1) * 0.5, 1, (Math.sin(f + 4.1887903) + 1) * 0.1);
    }
  }

  renderPickups() {
    const keep = [];
    for (const pk of this.pickups) {
      const t = (pk.bot.loop.time - pk.start) / 3;
      if (t >= 1 || t < 0) { this.removeEntityView(pk.e); continue; }
      const b = pk.bot.living.pose(pk.bot.pt);
      const f = t * t;
      pk.e.object.position.set(lerp(f, pk.from[0], b.x), lerp(f, pk.from[1], b.y + 0.5), lerp(f, pk.from[2], b.z));
      keep.push(pk);
    }
    this.pickups = keep;
  }

  advance(dt) {
    for (const bot of this.bots) bot.pt = bot.loop.advance(dt);
  }

  // Replays a bot's loop from its start up to `tick` (used for stills).
  seek(nick, tick) {
    const bot = this.bots.find((b) => b.nick === nick);
    if (!bot) return;
    bot.loop.tick = -1;
    bot.loop.time = 0;
    bot.pt = bot.loop.advance((tick + 0.5) / 20);
  }

  // Screen anchor above the bot's head (for cards), in world units.
  headAnchor(nick) {
    const bot = this.bots.find((b) => b.nick === nick);
    if (!bot) return null;
    const p = bot.living.pose(bot.pt);
    return [p.x, p.y + 2.55, p.z];
  }
}

function castShadows(object) {
  object.traverse((o) => {
    if (o.isMesh && o.material?.side !== 1) { o.castShadow = true; o.receiveShadow = true; }
  });
}

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
