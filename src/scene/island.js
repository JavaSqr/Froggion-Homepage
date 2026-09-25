// Island meshes (static + dynamic blocks) on top of the pure mesher.
import {
  BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  NearestFilter, NearestMipmapLinearFilter, RepeatWrapping, Texture, ClampToEdgeWrapping,
} from 'three';
import { createMesher, decodeGrid } from './mesher.js';
import { modelFor, texturesOf } from './blocks.js';

export const FLUID_TEXTURES = ['block/water_still', 'block/water_flow', 'block/lava_still'];

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
  return {
    map,
    // Lit by the sun and sky so blocks receive shadows; face shading and corner AO stay baked in.
    solid: new MeshLambertMaterial({ map, vertexColors: true }),
    cutout: new MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: DoubleSide }),
    waterStill: new MeshLambertMaterial({ map: waterStill, vertexColors: true, transparent: true, depthWrite: false }),
    waterFlow: new MeshLambertMaterial({ map: waterFlow, vertexColors: true, transparent: true, depthWrite: false }),
    lava: new MeshBasicMaterial({ map: lava, vertexColors: true }),
    animated: [waterStill, waterFlow, lava],
  };
}

/**
 * island: island.json. extraStates: block states used by dynamic blocks (scene.json palette).
 * dynamic: [[x, y, z, state]] initial dynamic cells in island-local coordinates.
 */
export function createIslandView({ island, extraStates, dynamic, atlas, materials, fade, depthFade }) {
  const palette = [...island.palette];
  const indexOf = new Map(palette.map((s, i) => [s, i]));
  for (const s of extraStates) if (!indexOf.has(s)) { indexOf.set(s, palette.length); palette.push(s); }
  const overrides = new Map();
  const grid = decodeGrid(island, overrides);
  const mesher = createMesher({ palette, uvOf: atlas.uvOf, fade, depthFade });
  const dynKeys = new Set(dynamic.map(([x, y, z]) => grid.index(x, y, z)));
  for (const [x, y, z, s] of dynamic) overrides.set(grid.index(x, y, z), indexOf.get(s));

  const group = new Group();
  group.name = 'island';
  const layers = ['solid', 'cutout', 'lava', 'waterFlow', 'waterStill'];
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

  // Each dynamic cell gets its own small meshes, rebuilt when its state changes.
  const dynGroup = new Group();
  group.add(dynGroup);
  const cellMeshes = new Map();
  function rebuildCell(x, y, z) {
    const key = grid.index(x, y, z);
    for (const m of cellMeshes.get(key) ?? []) { dynGroup.remove(m); m.geometry.dispose(); }
    const built = mesher.build(grid, { cells: [[x, y, z]] });
    const meshes = [];
    for (const layer of layers) {
      if (!built[layer].quads) continue;
      const mesh = new Mesh(geometry(built[layer]), materials[layer]);
      mesh.castShadow = !layer.startsWith('water');
      mesh.receiveShadow = true;
      dynGroup.add(mesh);
      meshes.push(mesh);
    }
    cellMeshes.set(key, meshes);
  }
  const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function setBlock(x, y, z, state) {
    const key = grid.index(x, y, z);
    let idx = indexOf.get(state);
    if (idx === undefined) { idx = palette.length; palette.push(state); indexOf.set(state, idx); mesher.models.push(modelFor(state)); }
    if (overrides.get(key) === idx) return;
    overrides.set(key, idx);
    rebuildCell(x, y, z);
    for (const [dx, dy, dz] of neighbors) if (dynKeys.has(grid.index(x + dx, y + dy, z + dz))) rebuildCell(x + dx, y + dy, z + dz);
  }
  for (const [x, y, z] of dynamic) rebuildCell(x, y, z);

  function update(seconds) {
    for (const t of materials.animated) {
      const frames = t.userData.frames;
      t.offset.y = (Math.floor(seconds * 10) % frames) / frames;
    }
  }

  return { group, setBlock, update, grid, palette, modelAt: (x, y, z) => mesher.models[grid.get(x, y, z)] };
}
