// Island scene: loads data and textures, builds the island and bots, runs the loop, exposes picking.
import {
  AmbientLight, ColorManagement, DirectionalLight, Fog, HemisphereLight, LinearSRGBColorSpace, PCFShadowMap,
  PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, Texture, NearestFilter,
} from 'three';
import { loadTextures, buildAtlas, loadImage } from './assets.js';
import { createIslandView, createMaterials, islandTextureNames, FLUID_TEXTURES } from './island.js';
import { decodeScene } from './timeline.js';
import { World } from './world.js';
import { Particles, PARTICLE_TEXTURES } from './particles.js';
import { ItemFactory } from './items.js';
import { modelFor } from './blocks.js';
import { CameraRig } from './camera.js';

ColorManagement.enabled = false;

const fetchJson = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });

function pixelTexture(image) {
  const t = new Texture(image);
  t.flipY = false;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export async function startScene({ layer, bots: meta, lite = false, debug = false }) {
  const [island, data] = await Promise.all([fetchJson('/data/island.json'), fetchJson('/data/scene.json')]);
  const decoded = decodeScene(data);

  // Every texture the scene uses, each from its own file.
  const blockNames = new Set([...islandTextureNames(island.palette), ...islandTextureNames(data.palette)]);
  const breakTextures = new Set();
  for (const b of decoded.bots) for (const list of b.effects.values()) for (const [, e] of list) {
    if (e.type !== 'break') continue;
    const m = modelFor(e.state);
    const t = m.kind === 'crop' || m.kind === 'cross' ? m.tex : m.kind === 'cube' ? m.tex.north : null;
    if (t) breakTextures.add(t);
  }
  const itemNames = new Set(['fishing_rod_cast']);
  for (const b of decoded.bots) {
    for (const list of b.events.values()) for (const e of list) if (e[1] === 'equip' && e[3]) itemNames.add(e[3]);
    for (const e of b.entities) if (e.item) itemNames.add(e.item);
  }
  const otherNames = new Set([
    ...FLUID_TEXTURES, ...PARTICLE_TEXTURES, ...breakTextures,
    ...[...itemNames].map((n) => `item/${n}`),
    'entity/creeper', 'entity/fishing_bobber', 'entity/experience_orb',
    ...Array.from({ length: 10 }, (_, i) => `block/destroy_stage_${i}`),
  ]);
  const [blockImages, otherImages, skinImages] = await Promise.all([
    loadTextures(blockNames),
    loadTextures(otherNames).catch((e) => { console.warn(e); return new Map(); }),
    Promise.all(meta.map(async (m) => [m.nick, await loadImage(m.skin)])).then((e) => new Map(e)),
  ]);
  const images = new Map([...blockImages, ...otherImages]);
  // Name tags are drawn into canvases, so the font has to be ready first.
  await document.fonts?.load('700 54px Handjet').catch(() => {});

  const atlas = buildAtlas(blockImages);
  const materials = createMaterials(atlas, images);
  const dynamic = [];
  for (const b of decoded.bots) for (const [x, y, z, s] of b.blocksInit) dynamic.push([x, y, z, s]);
  const view = createIslandView({ island, extraStates: data.palette, dynamic, atlas, materials, fade: { y0: 1, y1: 14 }, depthFade: { y0: 3, y1: 19, min: 0.12 } });

  const renderer = new WebGLRenderer({ antialias: !lite, alpha: true, powerPreference: lite ? 'low-power' : 'high-performance' });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  layer.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.add(view.group);
  // Muted daylight: sky and ground fill plus a low sun that casts soft shadows across the island.
  const [sx, , sz] = island.size;
  const center = new Vector3(sx / 2, 20, sz / 2);
  scene.add(new AmbientLight(0xffffff, 0.36 * Math.PI));
  scene.add(new HemisphereLight(0xc9d8e6, 0x3a3226, 0.25 * Math.PI));
  const sun = new DirectionalLight(0xfff1dc, 0.55 * Math.PI);
  sun.position.copy(center).add(new Vector3(-18, 30, 12));
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  scene.fog = new Fog(0x0b0f0c, 55, 110);

  const solidAt = (x, y, z) => {
    const m = view.modelAt(Math.floor(x), Math.floor(y), Math.floor(z));
    return !!(m && (m.opaque || m.kind === 'boxes'));
  };
  const waterAt = (x, y, z) => {
    const m = view.modelAt(Math.floor(x), Math.floor(y), Math.floor(z));
    return !!(m && ((m.kind === 'fluid' && m.fluid === 'water') || m.water));
  };
  const particleImages = new Map([...otherImages].filter(([n]) => n.startsWith('particle/') || breakTextures.has(n)));
  for (const t of breakTextures) if (blockImages.has(t)) particleImages.set(t, blockImages.get(t));
  const particles = new Particles({ images: particleImages, max: lite ? 400 : 1500, isSolid: solidAt, isWater: waterAt });
  scene.add(particles.points);

  const assets = {
    images,
    skins: new Map([...skinImages].map(([n, img]) => [n, pixelTexture(img)])),
    creeper: pixelTexture(images.get('entity/creeper')),
    destroy: Array.from({ length: 10 }, (_, i) => pixelTexture(images.get(`block/destroy_stage_${i}`))),
  };
  const world = new World({ scene, island: view, decoded, meta, assets, particles, items: new ItemFactory(images), lite });

  const camera = new PerspectiveCamera(35, 1, 0.1, 500);
  const rig = new CameraRig(camera, { island, decoded });

  let width = 0, height = 0;
  const resize = () => {
    width = layer.clientWidth; height = layer.clientHeight;
    renderer.setSize(width, height, false);
    rig.resize(width, height);
    particles.setViewport(height, camera.fov);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(layer);

  // Picking: a ray from the cursor against the bot models.
  const raycaster = new Raycaster();
  const pickables = world.bots.flatMap((b) => b.model.pickables);
  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.nick : null;
  }
  function anchor(nick, lift = 0) {
    const a = world.headAnchor(nick);
    if (!a) return null;
    const v = new Vector3(a[0], a[1] + lift, a[2]).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible: v.z < 1 && v.z > -1 };
  }
  const highlighted = new Set();
  function highlight(nicks) {
    const set = new Set(nicks.filter(Boolean));
    for (const b of world.bots) b.model.setOutline(set.has(b.nick));
    highlighted.clear();
    for (const n of set) highlighted.add(n);
  }

  // Main loop, paused off screen and in hidden tabs.
  const listeners = new Set();
  let running = false, frozen = false, last = 0, raf = 0, pAcc = 0, clock = 0, onScreen = true, lastRender = 0;
  const frameInterval = lite ? 1000 / 30 : 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (frameInterval && now - lastRender < frameInterval - 2) return;
    lastRender = now;
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    step(dt);
    draw();
  }
  function step(dt) {
    clock += dt;
    world.advance(dt);
    pAcc += dt * 20;
    while (pAcc >= 1) { particles.tick(); pAcc -= 1; }
    rig.update(dt);
  }
  function draw() {
    world.render(camera);
    particles.render(pAcc);
    view.update(clock);
    renderer.render(scene, camera);
    for (const fn of listeners) fn();
  }
  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) { last = performance.now(); raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf);
  }
  const update = () => setRunning(onScreen && !document.hidden && !frozen);
  document.addEventListener('visibilitychange', update);
  const io = new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting); update(); }, { threshold: 0 });
  io.observe(layer.closest('.hero') ?? layer);
  // Start mid-loop so the bots are already busy on the first frame.
  step(0.05);
  draw();
  update();
  layer.classList.add('is-live');

  const api = {
    ready: true,
    canvas: renderer.domElement,
    bots: world.bots.map((b) => b.nick),
    pick,
    anchor,
    highlight,
    onFrame(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    focusBot(nick, animate = true) { rig.focus(nick, animate); draw(); },
    seek(nick, tick) { world.seek(nick, tick); draw(); },
    heroView(animate = true) { rig.hero(animate); draw(); },
    // Runs the simulation for n seconds without waiting for frames (screenshots).
    settle(seconds) {
      const steps = Math.round(seconds * 30);
      for (let i = 0; i < steps; i++) step(1 / 30);
      draw();
    },
    // Stops the clock (stills and tests); the page's own pausing no longer restarts it.
    freeze(on = true) { frozen = on; update(); },
  };
  if (debug) Object.assign(api, { world, rig, renderer, scene, camera });
  return api;
}
