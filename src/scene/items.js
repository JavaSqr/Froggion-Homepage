// Items: each 16×16 sprite extruded into a 1/16-thick slab (front, back and a side quad per pixel edge),
// placed with the game's display transforms for third-person hands and the ground.
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshLambertMaterial, NearestFilter, Texture, FrontSide } from 'three';
import { DEG } from './model.js';

const HANDHELD = new Set(['diamond_pickaxe', 'diamond_sword', 'wooden_sword', 'iron_pickaxe', 'stone_pickaxe']);
const ROD = new Set(['fishing_rod', 'fishing_rod_cast']);

// thirdperson_righthand display transforms: [rotation deg], [translation px], scale.
export function handTransform(name) {
  if (ROD.has(name)) return { rotation: [0, 90, 55], translation: [0, 4, 2.5], scale: 0.85 };
  if (HANDHELD.has(name)) return { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: 0.85 };
  return { rotation: [0, 0, 0], translation: [0, 3, 1], scale: 0.55 };
}
export const GROUND = { rotation: [0, 0, 0], translation: [0, 2, 0], scale: 0.5 };

function pixels(image) {
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height).data;
}

// Geometry in pixels, x 0..16, y 0..16 (up), z 7.5..8.5, like generated item models.
export function extrudeSprite(image) {
  const w = image.width, h = image.height;
  const data = pixels(image);
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 127;
  const pos = [], uv = [], nor = [], idx = [];
  const sx = 16 / w, sy = 16 / h;
  const quad = (verts, uvs, n) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...verts[i]); uv.push(...uvs[i]); nor.push(...n); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const z0 = 7.5, z1 = 8.5;
  // Front (+z) and back (-z) show the whole sprite; transparent texels are cut by alphaTest.
  quad([[0, 16, z1], [0, 0, z1], [16, 0, z1], [16, 16, z1]], [[0, 0], [0, 1], [1, 1], [1, 0]], [0, 0, 1]);
  quad([[16, 16, z0], [16, 0, z0], [0, 0, z0], [0, 16, z0]], [[1, 0], [1, 1], [0, 1], [0, 0]], [0, 0, -1]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      const X0 = x * sx, X1 = (x + 1) * sx, Y1 = 16 - y * sy, Y0 = 16 - (y + 1) * sy;
      const u0 = x / w, u1 = (x + 1) / w, v0 = y / h, v1 = (y + 1) / h;
      const t = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
      if (!solid(x, y - 1)) quad([[X0, Y1, z0], [X0, Y1, z1], [X1, Y1, z1], [X1, Y1, z0]], t, [0, 1, 0]);
      if (!solid(x, y + 1)) quad([[X0, Y0, z1], [X0, Y0, z0], [X1, Y0, z0], [X1, Y0, z1]], t, [0, -1, 0]);
      if (!solid(x - 1, y)) quad([[X0, Y1, z0], [X0, Y0, z0], [X0, Y0, z1], [X0, Y1, z1]], t, [-1, 0, 0]);
      if (!solid(x + 1, y)) quad([[X1, Y1, z1], [X1, Y0, z1], [X1, Y0, z0], [X1, Y1, z0]], t, [1, 0, 0]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

export function spriteTexture(image) {
  const t = new Texture(image);
  t.flipY = false;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class ItemFactory {
  constructor(images) {
    this.images = images;
    this.cache = new Map();
  }

  model(name) {
    if (!this.cache.has(name)) {
      const img = this.images.get(`item/${name}`);
      if (!img) { this.cache.set(name, null); return null; }
      const material = new MeshLambertMaterial({ map: spriteTexture(img), alphaTest: 0.5, side: FrontSide });
      this.cache.set(name, { geometry: extrudeSprite(img), material });
    }
    return this.cache.get(name);
  }

  // Object in pixel units: T(translation) · R(xyz) · S · T(-8) · model.
  create(name, transform) {
    const m = this.model(name);
    if (!m) return null;
    const outer = new Group();
    outer.position.set(...transform.translation);
    outer.rotation.order = 'XYZ';
    outer.rotation.set(transform.rotation[0] * DEG, transform.rotation[1] * DEG, transform.rotation[2] * DEG);
    outer.scale.setScalar(transform.scale);
    const mesh = new Mesh(m.geometry, m.material);
    mesh.position.set(-8, -8, -8);
    outer.add(mesh);
    outer.userData.item = name;
    return outer;
  }
}
