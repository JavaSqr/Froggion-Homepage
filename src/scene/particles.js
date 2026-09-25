// Particles in one draw call: camera-facing points, each showing a rectangle of a particle atlas.
// Behaviour follows the game's particle classes, simplified. Ticks at 20 Hz, rendered interpolated.
import { BufferAttribute, BufferGeometry, CanvasTexture, NearestFilter, NormalBlending, Points, ShaderMaterial } from 'three';

const VERT = `
attribute float size;
attribute vec4 color;
attribute vec4 rect;
uniform float scale;
varying vec4 vColor;
varying vec4 vRect;
void main() {
  vColor = color;
  vRect = rect;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
varying vec4 vColor;
varying vec4 vRect;
void main() {
  vec2 uv = mix(vRect.xy, vRect.zw, gl_PointCoord);
  vec4 c = texture2D(map, uv) * vColor;
  if (c.a < 0.1) discard;
  gl_FragColor = c;
}`;

const gaussian = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// Square slots; non-square sprites are centred so points keep their aspect.
function buildParticleAtlas(images, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const rects = new Map();
  let x = 0, y = 0, row = 0;
  for (const [name, img] of images) {
    const s = Math.max(img.width, img.height);
    if (x + s > size) { x = 0; y += row; row = 0; }
    ctx.drawImage(img, x + (s - img.width) / 2, y + (s - img.height) / 2);
    rects.set(name, [x / size, y / size, (x + s) / size, (y + s) / size, img.width, img.height]);
    x += s; row = Math.max(row, s);
  }
  const tex = new CanvasTexture(canvas);
  tex.flipY = false;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  return { tex, rect: (n) => rects.get(n) };
}

export class Particles {
  constructor({ images, max = 1200, isSolid = () => false, isWater = () => false }) {
    this.atlas = buildParticleAtlas(images);
    this.max = max;
    this.list = [];
    this.isSolid = isSolid;
    this.isWater = isWater;
    this.dim = 0.8;
    const g = new BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 4);
    this.rect = new Float32Array(max * 4);
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('size', new BufferAttribute(this.size, 1));
    g.setAttribute('color', new BufferAttribute(this.color, 4));
    g.setAttribute('rect', new BufferAttribute(this.rect, 4));
    g.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      uniforms: { map: { value: this.atlas.tex }, scale: { value: 800 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.geometry = g;
  }

  setViewport(heightPx, fovDeg) {
    this.material.uniforms.scale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  add(p) {
    if (this.list.length >= this.max) return;
    p.age = 0;
    p.prev = [...p.pos];
    p.alpha ??= 1;
    p.rgb ??= [1, 1, 1];
    p.friction ??= 0.98;
    p.gravity ??= 0;
    this.list.push(p);
  }

  clear() { this.list.length = 0; }

  // Spawns what a world_particles packet would: count 0 means offset is the velocity.
  spawnPacket(name, pos, count, offset, speed) {
    const n = count === 0 ? 1 : count;
    for (let i = 0; i < n; i++) {
      let p = pos, v;
      if (count === 0) v = offset.map((o) => o * speed);
      else {
        p = [pos[0] + gaussian() * offset[0], pos[1] + gaussian() * offset[1], pos[2] + gaussian() * offset[2]];
        v = [gaussian() * speed, gaussian() * speed, gaussian() * speed];
      }
      this.spawn(name, p, v);
    }
  }

  spawn(name, pos, vel = [0, 0, 0]) {
    const r = Math.random;
    switch (name) {
      case 'fishing':
        return this.add({ pos: [...pos], vel: [...vel], gravity: 0, life: Math.floor(8 / (r() * 0.8 + 0.2)), frames: ['particle/fishing_0', 'particle/fishing_1', 'particle/fishing_2', 'particle/fishing_3'], frameMode: 'cycle', size: 0.12, wake: true });
      case 'bubble':
        return this.add({ pos: [...pos], vel: [vel[0] * 0.2 + (r() * 2 - 1) * 0.02, vel[1] * 0.2 + (r() * 2 - 1) * 0.02, vel[2] * 0.2 + (r() * 2 - 1) * 0.02], life: Math.floor(8 / (r() * 0.8 + 0.2)), sprite: 'particle/bubble', size: 0.1 * (r() * 0.6 + 0.2) * 2, friction: 0.85, rise: 0.002, needsWater: true });
      case 'splash': {
        const v = vel[1] === 0 && (vel[0] || vel[2]) ? [vel[0], 0.1, vel[2]] : [vel[0] * 0.3, r() * 0.2 + 0.1, vel[2] * 0.3];
        return this.add({ pos: [...pos], vel: v, gravity: 0.04, life: Math.floor(8 / (r() * 0.8 + 0.2)), sprite: `particle/splash_${Math.floor(r() * 4)}`, size: 0.14, rgb: [0.75, 0.85, 1], collide: true });
      }
      case 'sweep_attack': {
        const f = r() * 0.6 + 0.4;
        return this.add({ pos: [...pos], vel: [0, 0, 0], life: 4, frames: Array.from({ length: 8 }, (_, i) => `particle/sweep_${i}`), frameMode: 'age', size: 2 * (1 - vel[0] * 0.5), rgb: [f, f, f], friction: 0 });
      }
      case 'damage_indicator': {
        const f = r() * 0.3 + 0.6;
        return this.add({ pos: [...pos], vel: [vel[0] * 0.1 + vel[0] * 0.4, (vel[1] + 1) * 0.1 * 0.4 + 0.1, vel[2] * 0.1 + vel[2] * 0.4], gravity: 0.25, friction: 0.7, life: 20, sprite: 'particle/damage', size: 0.18, rgb: [f, f, f] });
      }
      case 'large_smoke':
      case 'smoke': {
        const c = 0.3 + r() * 0.3;
        const scale = name === 'large_smoke' ? 2.5 : 1;
        return this.add({ pos: [...pos], vel: [vel[0] * 0.1, vel[1] * 0.1, vel[2] * 0.1], rise: 0.004, friction: 0.96, life: Math.floor((8 / (r() * 0.8 + 0.2)) * scale), frames: genericFrames(), frameMode: 'age', size: 0.2 * (r() * 0.5 + 0.5) * 0.75 * scale, rgb: [c, c, c], alpha: 0.75 });
      }
      case 'flame':
        return this.add({ pos: [pos[0] + (r() - 0.5) * 0.05, pos[1], pos[2] + (r() - 0.5) * 0.05], vel: [vel[0] * 0.01, vel[1] * 0.01 + 0.004, vel[2] * 0.01], friction: 0.96, life: Math.floor(8 / (r() * 0.8 + 0.2)) + 4, sprite: 'particle/flame', size: 0.12 * (r() * 0.4 + 0.8), shrink: true, bright: true });
      case 'lava':
        return this.add({ pos: [...pos], vel: [(r() - 0.5) * 0.12, r() * 0.4 + 0.05, (r() - 0.5) * 0.12], gravity: 0.75, friction: 0.999, life: Math.floor(16 / (r() * 0.8 + 0.2)), sprite: 'particle/lava', size: 0.1 * (r() * 2 + 0.2), shrink: true, bright: true, collide: true });
      case 'poof': {
        const c = r() * 0.3 + 0.7;
        return this.add({ pos: [...pos], vel: [vel[0] + (r() * 2 - 1) * 0.05, vel[1] + (r() * 2 - 1) * 0.05, vel[2] + (r() * 2 - 1) * 0.05], rise: 0.004, friction: 0.9, life: Math.floor(16 / (r() * 0.8 + 0.2)) + 2, frames: genericFrames(), frameMode: 'age', size: 0.14 * (r() * r() * 4 + 1), rgb: [c, c, c], alpha: 0.9 });
      }
      default:
        return undefined;
    }
  }

  // Block break: a 4×4×4 grid of chips flying out, textured with bits of the block.
  blockBreak(block, texture, box = [[0, 0, 0], [1, 1, 1]], density = 4) {
    const base = this.atlas.rect(texture);
    if (!base) return;
    const [lo, hi] = box;
    for (let i = 0; i < density; i++) for (let j = 0; j < density; j++) for (let k = 0; k < density; k++) {
      const d = [(i + 0.5) / density, (j + 0.5) / density, (k + 0.5) / density];
      const p = [block[0] + lo[0] + d[0] * (hi[0] - lo[0]), block[1] + lo[1] + d[1] * (hi[1] - lo[1]), block[2] + lo[2] + d[2] * (hi[2] - lo[2])];
      let v = [d[0] - 0.5 + (Math.random() * 2 - 1) * 0.4, d[1] - 0.5 + (Math.random() * 2 - 1) * 0.4, d[2] - 0.5 + (Math.random() * 2 - 1) * 0.4];
      const s = ((Math.random() + Math.random() + 1) * 0.15) / (Math.hypot(...v) || 1);
      v = [v[0] * s * 0.4, v[1] * s * 0.4 + 0.1, v[2] * s * 0.4];
      const uo = Math.floor(Math.random() * 4), vo = Math.floor(Math.random() * 4);
      const du = (base[2] - base[0]) / 4, dv = (base[3] - base[1]) / 4;
      const rect = [base[0] + uo * du, base[1] + vo * dv, base[0] + (uo + 1) * du, base[1] + (vo + 1) * dv];
      this.add({ pos: p, vel: v, gravity: 1, life: Math.floor(4 / (Math.random() * 0.9 + 0.1)), rectOverride: rect, size: 0.1 * (Math.random() * 0.5 + 0.5), rgb: [0.6, 0.6, 0.6], collide: true });
    }
  }

  tick() {
    const keep = [];
    for (const p of this.list) {
      p.prev[0] = p.pos[0]; p.prev[1] = p.pos[1]; p.prev[2] = p.pos[2];
      if (++p.age >= p.life) continue;
      p.vel[1] -= 0.04 * p.gravity;
      if (p.rise) p.vel[1] += p.rise;
      const nx = p.pos[0] + p.vel[0], ny = p.pos[1] + p.vel[1], nz = p.pos[2] + p.vel[2];
      if (p.collide && this.isSolid(nx, ny, nz)) {
        p.vel[1] = 0;
        p.vel[0] *= 0.7; p.vel[2] *= 0.7;
        p.pos[0] = nx; p.pos[2] = nz;
        p.pos[1] = Math.floor(ny) + 1.0001;
        if (this.isSolid(p.pos[0], p.pos[1], p.pos[2])) p.pos[1] = p.prev[1];
      } else {
        p.pos[0] = nx; p.pos[1] = ny; p.pos[2] = nz;
      }
      if (p.needsWater && !this.isWater(p.pos[0], p.pos[1], p.pos[2])) continue;
      if (p.wake && this.isSolid(p.pos[0], p.pos[1], p.pos[2])) continue;
      const fr = p.friction;
      if (fr) { p.vel[0] *= fr; p.vel[1] *= fr; p.vel[2] *= fr; }
      keep.push(p);
    }
    this.list = keep;
  }

  render(pt) {
    const n = Math.min(this.list.length, this.max);
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      this.pos[i * 3] = p.prev[0] + (p.pos[0] - p.prev[0]) * pt;
      this.pos[i * 3 + 1] = p.prev[1] + (p.pos[1] - p.prev[1]) * pt;
      this.pos[i * 3 + 2] = p.prev[2] + (p.pos[2] - p.prev[2]) * pt;
      let name = p.sprite;
      if (p.frames) {
        const idx = p.frameMode === 'age' ? Math.min(p.frames.length - 1, Math.floor(((p.age + pt) * p.frames.length) / p.life)) : p.age % p.frames.length;
        name = p.frames[idx];
      }
      const r = p.rectOverride ?? this.atlas.rect(name) ?? [0, 0, 0, 0];
      this.rect.set([r[0], r[1], r[2], r[3]], i * 4);
      const k = p.bright ? 1 : this.dim;
      this.color.set([p.rgb[0] * k, p.rgb[1] * k, p.rgb[2] * k, p.alpha], i * 4);
      const age = (p.age + pt) / p.life;
      this.size[i] = p.shrink ? p.size * (1 - age * age * 0.5) : p.size;
    }
    const g = this.geometry;
    g.setDrawRange(0, n);
    for (const a of ['position', 'size', 'color', 'rect']) g.attributes[a].needsUpdate = true;
  }
}

function genericFrames() {
  return Array.from({ length: 8 }, (_, i) => `particle/generic_${i}`);
}

export const PARTICLE_TEXTURES = [
  ...Array.from({ length: 8 }, (_, i) => `particle/generic_${i}`),
  ...Array.from({ length: 4 }, (_, i) => `particle/splash_${i}`),
  ...Array.from({ length: 4 }, (_, i) => `particle/fishing_${i}`),
  ...Array.from({ length: 8 }, (_, i) => `particle/sweep_${i}`),
  'particle/bubble', 'particle/damage', 'particle/flame', 'particle/lava', 'particle/glow',
];
