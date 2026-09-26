// Lighting and sky for the two variants of the scene.
//   day:   muted daylight, a low sun with soft shadows.
//   night: block light baked into the island (lanterns, torches, lava), moonlight with shadows,
//          stars, a moon, warm glows around the lights, flames and smoke on torches.
import {
  AdditiveBlending, AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, HemisphereLight,
  InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, Mesh, PlaneGeometry, Points, PointsMaterial,
  ShaderMaterial, Sprite, SpriteMaterial, Vector3,
} from 'three';
import { spriteTexture } from './items.js';
import { lavaTicker } from './lava.js';

function shadowLight(light, center, lite, span = 22) {
  light.target.position.copy(center);
  light.castShadow = true;
  light.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  Object.assign(light.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 120 });
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.03;
  light.shadow.radius = 3;
  return light;
}

export function dayAtmosphere(scene, { center, lite, lava, particles }) {
  scene.add(new AmbientLight(0xffffff, 0.36 * Math.PI));
  scene.add(new HemisphereLight(0xc9d8e6, 0x3a3226, 0.25 * Math.PI));
  const sun = shadowLight(new DirectionalLight(0xfff1dc, 0.55 * Math.PI), center, lite);
  sun.position.copy(center).add(new Vector3(-18, 30, 12));
  scene.add(sun, sun.target);
  scene.fog = new Fog(0x0b0f0c, 55, 110);
  return { variant: 'day', tick: lavaTicker(lava, particles), update() {}, particleDim: 0.8 };
}

// Direction in the upper right of the first-screen view, for the moon.
function moonDirection(heroPose) {
  const f = new Vector3().subVectors(heroPose.target, heroPose.pos).normalize();
  const right = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, f).normalize();
  return f.clone().addScaledVector(right, 0.3).addScaledVector(up, 0.24).normalize();
}

function stars(center, count) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const d = new Vector3(r * Math.cos(a), u, r * Math.sin(a));
    pos.set([center.x + d.x * 260, center.y + d.y * 260, center.z + d.z * 260], i * 3);
    const b = (0.35 + rnd() * 0.65) * (d.y < -0.1 ? 0.45 : 1);
    col.set([b * 0.9, b * 0.93, b], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  const points = new Points(g, new PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
  points.frustumCulled = false;
  points.renderOrder = -2;
  return points;
}

// Glows over the lights: a wide halo and a bright core, added over the picture without depth test,
// so no block cuts them into flat shapes. Blocks between the camera and a light fade its glow
// (a few rays through the island's cells), and a glow fades when the camera comes close.
const GLOW = {
  lantern: { size: 3.2, core: 0.9, color: 0xffb05a, opacity: 0.5, y: 0.3 },
  torch: { size: 2.4, core: 0.6, color: 0xffa04a, opacity: 0.45, y: 0.72 },
  lava: { size: 4.2, core: 0, color: 0xff7426, opacity: 0.4, y: 0.9 },
};
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// All glows in one draw call: camera-facing quads, each with its own centre, size and tint
// (the tint carries the opacity, which is the same thing under additive blending).
function glowBatch(texture, max) {
  const g = new InstancedBufferGeometry().copy(new PlaneGeometry(1, 1));
  const center = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const size = new InstancedBufferAttribute(new Float32Array(max), 1);
  const tint = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  g.setAttribute('center', center);
  g.setAttribute('size', size);
  g.setAttribute('tint', tint);
  g.instanceCount = 0;
  const mesh = new Mesh(g, new ShaderMaterial({
    uniforms: { map: { value: texture } },
    vertexShader: `attribute vec3 center; attribute float size; attribute vec3 tint; varying vec2 vUv; varying vec3 vTint;
      void main() { vUv = uv; vTint = tint; vec4 mv = modelViewMatrix * vec4(center, 1.0); mv.xy += position.xy * size; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vTint;
      void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vTint, t.a); }`,
    blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  let n = 0;
  return {
    mesh,
    begin() { n = 0; },
    add(pos, s, color, opacity) {
      center.setXYZ(n, pos.x, pos.y, pos.z);
      size.setX(n, s);
      tint.setXYZ(n, color.r * opacity, color.g * opacity, color.b * opacity);
      n++;
    },
    end() {
      g.instanceCount = n;
      for (const a of [center, size, tint]) a.needsUpdate = true;
    },
  };
}

export function nightAtmosphere(scene, { center, lite, heroPose, images, emitters, lava, particles, occludes }) {
  // The baked island colours already carry the light, so the base light is plain white.
  scene.add(new AmbientLight(0xffffff, Math.PI));
  const moonDir = moonDirection(heroPose);
  // Moonlight comes from the moon's side of the sky but a little towards the viewer, so faces facing us catch it.
  const lightDir = moonDir.clone().setY(0).applyAxisAngle(new Vector3(0, 1, 0), -1.1).normalize().setY(1.15).normalize();
  const moon = shadowLight(new DirectionalLight(0x9fb3e6, 0.3 * Math.PI), center, lite, 24);
  moon.position.copy(center).addScaledVector(lightDir, 45);
  scene.add(moon, moon.target);
  scene.fog = new Fog(0x070b12, 50, 115);

  scene.add(stars(center, lite ? 500 : 1100));
  const moonSprite = new Sprite(new SpriteMaterial({ map: spriteTexture(images.get('environment/moon')), color: 0xb9c3d8, fog: false, depthWrite: false, transparent: true }));
  moonSprite.position.copy(center).addScaledVector(moonDir, 220);
  moonSprite.scale.set(15, 15, 1);
  moonSprite.renderOrder = -1;
  scene.add(moonSprite);
  const glowTex = spriteTexture(images.get('particle/glow'));
  glowTex.magFilter = glowTex.minFilter = LinearFilter; // a soft halo, not pixels
  const moonHalo = new Sprite(new SpriteMaterial({ map: glowTex, color: 0x6f86c4, opacity: 0.55, blending: AdditiveBlending, fog: false, depthWrite: false, transparent: true }));
  moonHalo.position.copy(moonSprite.position);
  moonHalo.scale.set(70, 70, 1);
  moonHalo.renderOrder = -1;
  scene.add(moonHalo);

  const glows = [];
  const others = emitters.filter((e) => e[4] !== 'lava');
  const coreColor = new Color(0xffe3a8);
  const addGlow = (x, y, z, kind, strength = 1) => {
    const g = GLOW[kind] ?? GLOW.lantern;
    glows.push({ pos: new Vector3(x, y, z), size: g.size, core: g.core, color: new Color(g.color), base: g.opacity * strength, flicker: 0, vis: 0 });
  };
  for (const [x, y, z, , kind] of others) addGlow(x + 0.5, y + (GLOW[kind] ?? GLOW.lantern).y, z + 0.5, kind);
  // Lava: one glow over a pool, a row of them down each lavafall.
  for (const g of lava.glows) addGlow(...g.at, 'lava', g.pool ? 1 : 0.8 * g.strength);
  const batch = glowBatch(glowTex, Math.max(1, glows.length * 2));
  scene.add(batch.mesh);
  const lavaTick = lavaTicker(lava, particles);

  const right = new Vector3(), up = new Vector3(), probe = new Vector3();
  let frame = 0;
  return {
    variant: 'night',
    particleDim: 0.45,
    // Per game tick: torches smoke and flicker, lava spits now and then.
    tick() {
      for (const [x, y, z, , kind] of others) {
        if (kind === 'torch' && Math.random() < 0.08) {
          particles.spawn('smoke', [x + 0.5, y + 0.7, z + 0.5]);
          particles.spawn('flame', [x + 0.5, y + 0.7, z + 0.5]);
        }
      }
      lavaTick();
      for (const g of glows) {
        g.flicker += (Math.random() - Math.random()) * Math.random() * Math.random() * 0.1;
        g.flicker *= 0.9;
      }
    },
    // Per frame, after the camera moved: how much of each light is in sight.
    update(camera, dt) {
      const check = !occludes || dt === 0 || frame++ % 2 === 0;
      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      const k = dt === 0 ? 1 : 1 - Math.exp(-dt * 10);
      batch.begin();
      for (const g of glows) {
        if (check && occludes) {
          let seen = 0;
          for (const [a, b] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
            probe.copy(g.pos).addScaledVector(right, a).addScaledVector(up, b);
            if (!occludes(camera.position, probe)) seen++;
          }
          g.target = seen / 5;
        }
        g.vis = g.seen ? g.vis + (g.target - g.vis) * k : g.target ?? 1;
        g.seen = true;
        const near = smoothstep(0.8, 3.5, camera.position.distanceTo(g.pos));
        const o = Math.max(0, g.base * g.vis * near * (1 + g.flicker * 1.5));
        if (o <= 0.003) continue;
        batch.add(g.pos, g.size, g.color, o);
        if (g.core) batch.add(g.pos, g.core, coreColor, Math.min(1, o * 1.6));
      }
      batch.end();
    },
  };
}
