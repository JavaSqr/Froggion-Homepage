// Island scene: loads data and textures, builds the island and bots, runs the loop, exposes picking.
import {
  ColorManagement, LinearSRGBColorSpace, PCFShadowMap, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3,
  WebGLRenderer, Texture, NearestFilter,
} from 'three';
import { loadTextures, buildAtlas, loadImage, versioned } from './assets.js';
import { createIslandView, createMaterials, islandTextureNames, FLUID_TEXTURES } from './island.js';
import { decodeScene } from './timeline.js';
import { World } from './world.js';
import { Particles, PARTICLE_TEXTURES } from './particles.js';
import { ItemFactory } from './items.js';
import { modelFor } from './blocks.js';
import { CameraRig } from './camera.js';
import { dayAtmosphere, nightAtmosphere } from './atmosphere.js';
import { nightLightmap } from './light.js';
import { NameTags } from './nametags.js';
import { lavaLayout } from './lava.js';

ColorManagement.enabled = false;

const DATA = `${import.meta.env.BASE_URL}data/`;
// Lavafalls dissolve into the void below the island.
const LAVA_FADE = { y0: 2, y1: 12 };
const fetchJson = (u) => fetch(versioned(u)).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });

function pixelTexture(image) {
  const t = new Texture(image);
  t.flipY = false;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// visibleWith: elements that leave the fixed scene layer in sight; the loop pauses when none is on screen.
export async function startScene({ layer, bots: meta, lite = false, debug = false, variant = 'day', visibleWith = [layer] }) {
  const night = variant === 'night';
  const [island, data, nightData] = await Promise.all([
    fetchJson(`${DATA}island.json`), fetchJson(`${DATA}scene.json`),
    night ? fetchJson(`${DATA}night.json`) : Promise.resolve({ blocks: [] }),
  ]);
  const decoded = decodeScene(data);
  const nightStates = nightData.blocks.map((b) => b[3]);

  // Every texture the scene uses, each from its own file.
  const blockNames = new Set([...islandTextureNames(island.palette), ...islandTextureNames(data.palette), ...islandTextureNames(nightStates)]);
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
    ...(night ? ['environment/moon'] : []),
    ...Array.from({ length: 10 }, (_, i) => `block/destroy_stage_${i}`),
  ]);
  const [blockImages, otherImages, skinImages] = await Promise.all([
    loadTextures(blockNames),
    loadTextures(otherNames).catch((e) => { console.warn(e); return new Map(); }),
    Promise.all(meta.map(async (m) => [m.nick, await loadImage(m.skin)])).then((e) => new Map(e)),
  ]);
  const images = new Map([...blockImages, ...otherImages]);

  const atlas = buildAtlas(blockImages);
  const materials = createMaterials(atlas, images);
  const dynamic = [];
  for (const b of decoded.bots) for (const [x, y, z, s] of b.blocksInit) dynamic.push([x, y, z, s]);
  const view = createIslandView({
    island, extraStates: data.palette, dynamic, extraStatic: nightData.blocks, atlas, materials,
    fade: { y0: 1, y1: 14 }, lavaFade: LAVA_FADE, depthFade: { y0: 3, y1: 19, min: 0.12 }, lightmap: night ? nightLightmap() : null,
  });

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
  const [sx, , sz] = island.size;
  const center = new Vector3(sx / 2, 20, sz / 2);
  const camera = new PerspectiveCamera(35, 1, 0.1, 600);
  const rig = new CameraRig(camera, { island, decoded });

  const solidAt = (x, y, z) => {
    const m = view.modelAt(Math.floor(x), Math.floor(y), Math.floor(z));
    return !!(m && (m.opaque || m.kind === 'boxes'));
  };
  const waterAt = (x, y, z) => {
    const m = view.modelAt(Math.floor(x), Math.floor(y), Math.floor(z));
    return !!(m && ((m.kind === 'fluid' && m.fluid === 'water') || m.water));
  };
  // Whether a full block (not glass) stands between two points: fades name tags and light glows.
  const occludes = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    for (let t = 0.5; t < len - 0.7; t += 0.25) {
      const k = t / len;
      const m = view.modelAt(Math.floor(from.x + dx * k), Math.floor(from.y + dy * k), Math.floor(from.z + dz * k));
      if (m && m.kind === 'cube' && !m.cullSame) return true;
    }
    return false;
  };
  const particleImages = new Map([...otherImages].filter(([n]) => n.startsWith('particle/') || breakTextures.has(n)));
  for (const t of breakTextures) if (blockImages.has(t)) particleImages.set(t, blockImages.get(t));
  const particles = new Particles({ images: particleImages, max: lite ? 400 : 1500, isSolid: solidAt, isWater: waterAt });
  scene.add(particles.points);
  const lava = lavaLayout(view, LAVA_FADE);
  const atmosphere = night
    ? nightAtmosphere(scene, { center, lite, heroPose: rig.heroPose(0), images, emitters: view.emitters, lava, particles, occludes })
    : dayAtmosphere(scene, { center, lite, lava, particles });
  particles.dim = atmosphere.particleDim;

  const assets = {
    images,
    skins: new Map([...skinImages].map(([n, img]) => [n, pixelTexture(img)])),
    creeper: pixelTexture(images.get('entity/creeper')),
    destroy: Array.from({ length: 10 }, (_, i) => pixelTexture(images.get(`block/destroy_stage_${i}`))),
  };
  const world = new World({ scene, island: view, decoded, meta, assets, particles, items: new ItemFactory(images), lite, lit: night });
  const tags = new NameTags(layer, world.bots, occludes);

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
    // rAF time can be a little older than the moment the loop was started.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt);
    draw();
  }
  function step(dt) {
    clock += dt;
    world.advance(dt);
    pAcc += dt * 20;
    while (pAcc >= 1) { atmosphere.tick(); particles.tick(); pAcc -= 1; }
    rig.update(dt);
    atmosphere.update(camera, dt);
  }
  function draw() {
    world.render(camera);
    particles.render(pAcc);
    view.update(clock);
    renderer.render(scene, camera);
    tags.update(camera, width, height);
    for (const fn of listeners) fn();
  }
  // A frame for the current view at once, glows included (stills and jumps while paused).
  function still() {
    atmosphere.update(camera, 0);
    draw();
  }
  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) { last = performance.now(); raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf);
  }
  const update = () => setRunning(onScreen && !document.hidden && !frozen);
  document.addEventListener('visibilitychange', update);
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target, e.isIntersecting);
    onScreen = [...seen.values()].some(Boolean);
    update();
  }, { threshold: 0 });
  for (const el of visibleWith) if (el) io.observe(el);
  // Start mid-loop so the bots are already busy on the first frame.
  step(0.05);
  draw();
  update();
  layer.classList.add('is-live');

  const api = {
    ready: true,
    variant,
    canvas: renderer.domElement,
    bots: world.bots.map((b) => b.nick),
    pick,
    anchor,
    highlight,
    onFrame(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    focusBot(nick, animate = true) { rig.focus(nick, animate); still(); },
    seek(nick, tick) { world.seek(nick, tick); still(); },
    heroView(animate = true) { rig.hero(animate); still(); },
    // Scroll flight: the stops in order, then progress along them (-1 = first screen).
    setPath(nicks) { rig.setPath(nicks); },
    fly(s, instant = false) { rig.fly(s, instant); if (instant && !running) still(); },
    jump(index) { rig.jump(index); },
    // Stills of the stations are framed in the middle, without the first screen's shift.
    centerView(on = true) { rig.centered = on; rig.resize(width, height); still(); },
    // Runs the simulation for n seconds without waiting for frames (screenshots).
    settle(seconds) {
      const steps = Math.round(seconds * 30);
      for (let i = 0; i < steps; i++) step(1 / 30);
      still();
    },
    // Stops the clock (stills and tests); the page's own pausing no longer restarts it.
    freeze(on = true) { frozen = on; update(); },
  };
  if (debug) Object.assign(api, { world, rig, renderer, scene, camera, atmosphere, tags });
  return api;
}
