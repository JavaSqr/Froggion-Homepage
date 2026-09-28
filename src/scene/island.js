// Island meshes (static + dynamic blocks) on top of the pure mesher.
import {
  BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  NearestFilter, NearestMipmapLinearFilter, RepeatWrapping, Texture, ClampToEdgeWrapping,
} from 'three';
import { createMesher, decodeGrid } from './mesher.js';
import { modelFor, texturesOf } from './blocks.js';
import { computeLight } from './light.js';

export const FLUID_TEXTURES = ['block/water_still', 'block/water_flow', 'block/lava_still', 'block/lava_flow'];

export function islandTextureNames(palette) {
  const names = new Set();
  for (const s of palette) for (const t of texturesOf(modelFor(s))) names.add(t);
  return names;
}

function geometry(arrays) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(arrays.position, 3));
  g.setAttribute('uv', new BufferAttribute(arrays.uv, 2));
  g.setAttribute('color', new BufferAttribute(arrays.color, 4));
  g.setIndex(new BufferAttribute(arrays.index, 1));
  g.computeBoundingSphere();
  return g;
}

function stripTexture(image) {
  const t = new Texture(image);
  t.flipY = false;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = RepeatWrapping;
  t.userData.frames = Math.max(1, Math.round(image.height / image.width));
  t.repeat.set(1, 1 / t.userData.frames);
  t.needsUpdate = true;
  return t;
}

export function createMaterials(atlas, images) {
  const map = new CanvasTexture(atlas.canvas);
  map.flipY = false;
  map.magFilter = NearestFilter;
  map.minFilter = NearestMipmapLinearFilter;
  map.anisotropy = 4;
  const waterStill = stripTexture(images.get('block/water_still'));
  const waterFlow = stripTexture(images.get('block/water_flow'));
  const lava = stripTexture(images.get('block/lava_still'));
  const lavaFlow = stripTexture(images.get('block/lava_flow'));
  return {
    map,
    // Lit by the sun and sky so blocks receive shadows; face shading and corner AO stay baked in.
    solid: new MeshLambertMaterial({ map, vertexColors: true }),
    cutout: new MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: DoubleSide }),
    waterStill: new MeshLambertMaterial({ map: waterStill, vertexColors: true, transparent: true, depthWrite: false }),
    waterFlow: new MeshLambertMaterial({ map: waterFlow, vertexColors: true, transparent: true, depthWrite: false }),
    // Lava is not lit, it glows; transparent only so that the lavafalls can fade out at the bottom.
    lava: new MeshBasicMaterial({ map: lava, vertexColors: true, transparent: true }),
    // Sides of lava use the flowing texture, as in the game.
    lavaFlow: new MeshBasicMaterial({ map: lavaFlow, vertexColors: true, transparent: true }),
    animated: [waterStill, waterFlow, lava, lavaFlow],
  };
}

/**
 * island: island.json. extraStates: block states used by dynamic blocks (scene.json palette).
 * dynamic: [[x, y, z, state]] initial dynamic cells in island-local coordinates.
 * extraStatic: [[x, y, z, state]] blocks added to the island (night lights).
 * lightmap: (block, sky) → [r, g, b]; when set, block and sky light are baked into the mesh.
 */
export function createIslandView({ island, extraStates, dynamic, extraStatic = [], atlas, materials, fade, lavaFade, depthFade, lightmap = null }) {
  const palette = [...island.palette];
  const indexOf = new Map(palette.map((s, i) => [s, i]));
  const addState = (s) => { if (!indexOf.has(s)) { indexOf.set(s, palette.length); palette.push(s); } return indexOf.get(s); };
  for (const s of extraStates) addState(s);
  for (const [, , , s] of extraStatic) addState(s);
  const overrides = new Map();
  const grid = decodeGrid(island, overrides);
  const dynKeys = new Set(dynamic.map(([x, y, z]) => grid.index(x, y, z)));
  for (const [x, y, z, s] of dynamic) overrides.set(grid.index(x, y, z), indexOf.get(s));
  for (const [x, y, z, s] of extraStatic) overrides.set(grid.index(x, y, z), indexOf.get(s));
  // Light is baked once: the cells the bots change count as air, so a block mined later (cobblestone by the lava)
  // does not leave a pocket of darkness on the faces around it.
  const lightGrid = { size: grid.size, get: (x, y, z) => (dynKeys.has(grid.index(x, y, z)) ? 0 : grid.get(x, y, z)) };
  const light = lightmap ? computeLight(lightGrid, palette.map((s) => modelFor(s))) : null;
  const mesher = createMesher({ palette, uvOf: atlas.uvOf, fade, lavaFade, depthFade, lighting: light ? { light, map: lightmap } : null });

  const group = new Group();
  group.name = 'island';
  const layers = ['solid', 'cutout', 'lava', 'lavaFlow', 'waterFlow', 'waterStill'];
  const staticBuild = mesher.build(grid, { skip: (x, y, z) => dynKeys.has(grid.index(x, y, z)) });
  for (const layer of layers) {
    if (!staticBuild[layer].quads) continue;
    const mesh = new Mesh(geometry(staticBuild[layer]), materials[layer]);
    mesh.name = `island-${layer}`;
    if (layer.startsWith('water')) mesh.renderOrder = 2;
    mesh.castShadow = !layer.startsWith('water');
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // The cells the bots change share one mesh per layer, rebuilt (before the next frame) when one of them changes.
  const dynGroup = new Group();
  group.add(dynGroup);
  const dynCells = dynamic.map(([x, y, z]) => [x, y, z]);
  let dirty = true;
  function rebuildDynamic() {
    dirty = false;
    for (const m of [...dynGroup.children]) { dynGroup.remove(m); m.geometry.dispose(); }
    const built = mesher.build(grid, { cells: dynCells });
    for (const layer of layers) {
      if (!built[layer].quads) continue;
      const mesh = new Mesh(geometry(built[layer]), materials[layer]);
      if (layer.startsWith('water')) mesh.renderOrder = 2;
      mesh.castShadow = !layer.startsWith('water');
      mesh.receiveShadow = true;
      dynGroup.add(mesh);
    }
  }
  function setBlock(x, y, z, state) {
    const key = grid.index(x, y, z);
    let idx = indexOf.get(state);
    if (idx === undefined) { idx = palette.length; palette.push(state); indexOf.set(state, idx); mesher.models.push(modelFor(state)); }
    if (overrides.get(key) === idx) return;
    overrides.set(key, idx);
    dirty = true;
  }
  rebuildDynamic();

  function update(seconds) {
    if (dirty) rebuildDynamic();
    for (const t of materials.animated) {
      const frames = t.userData.frames;
      t.offset.y = (Math.floor(seconds * 10) % frames) / frames;
    }
  }

  // Light sources for glows: [x, y, z, level, kind] in island-local cell coordinates.
  const emitters = [];
  const [sx, sy, sz] = grid.size;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const m = mesher.models[grid.get(x, y, z)];
    if (m?.emit) emitters.push([x, y, z, m.emit, palette[grid.get(x, y, z)].split('[')[0]]);
  }

  return {
    group, setBlock, update, grid, palette, emitters,
    modelAt: (x, y, z) => mesher.models[grid.get(x, y, z)],
    // Light colour at a point (entities are lit by the cell they stand in, like in the game).
    lightColor(x, y, z) {
      if (!light) return null;
      const [b, sk] = light.at(Math.floor(x), Math.floor(y), Math.floor(z));
      return lightmap(b, sk);
    },
  };
}
