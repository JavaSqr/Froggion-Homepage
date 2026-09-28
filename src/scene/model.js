// Entity model boxes with the game's box UV layout, built in model space (pixels, y down),
// plus the transform that puts model space upright into the world.
import { Bone, BufferAttribute, BufferGeometry, Group, Matrix4, Skeleton, SkinnedMesh } from 'three';

/** Port of the box constructor: texture offset (u, v), origin (x, y, z), size (w, h, d), inflate g. */
export function boxGeometry(texW, texH, u, v, x, y, z, w, h, d, g = 0, mirror = false) {
  let x0 = x - g, y0 = y - g, z0 = z - g, x1 = x + w + g, y1 = y + h + g, z1 = z + d + g;
  if (mirror) [x0, x1] = [x1, x0];
  const p7 = [x0, y0, z0], p0 = [x1, y0, z0], p1 = [x1, y1, z0], p2 = [x0, y1, z0];
  const p3 = [x0, y0, z1], p4 = [x1, y0, z1], p5 = [x1, y1, z1], p6 = [x0, y1, z1];
  const u0 = u, u1 = u + d, u2 = u + d + w, u3 = u + d + w + w, u4 = u + d + w + d, u5 = u + d + w + d + w;
  const v0 = v, v1 = v + d, v2 = v + d + h;
  const quads = [
    [[p4, p3, p7, p0], u1, v0, u2, v1],
    [[p1, p2, p6, p5], u2, v1, u3, v0],
    [[p7, p3, p6, p2], u0, v1, u1, v2],
    [[p0, p7, p2, p1], u1, v1, u2, v2],
    [[p4, p0, p1, p5], u2, v1, u4, v2],
    [[p3, p4, p5, p6], u4, v1, u5, v2],
  ];
  const pos = [], uv = [], nor = [], idx = [];
  for (const [verts, ua, va, ub, vb] of quads) {
    const q = mirror ? [...verts].reverse() : verts;
    const t = [[ub, va], [ua, va], [ua, vb], [ub, vb]];
    const tt = mirror ? [...t].reverse() : t;
    const a = q[0], b = q[1], c = q[2];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((c2) => c2 / len);
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(...q[i]);
      uv.push(tt[i][0] / texW, tt[i][1] / texH);
      nor.push(...n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setIndex(idx);
  return geo;
}

/**
 * One draw call for a whole model: boxes of several parts merged into a skinned mesh, each part a bone
 * and each vertex bound to its part. pieces: [[part, geometry, group]]; `group` picks the material
 * when `material` is a list. The vertices stay in their part's space, so the bind pose is identity.
 */
export function skinnedModel(pieces, material) {
  const bones = [...new Set(pieces.map(([p]) => p.group))];
  const pos = [], uv = [], nor = [], idx = [], skinIndex = [], skinWeight = [];
  const geo = new BufferGeometry();
  const sorted = [...pieces].sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0));
  let groupStart = 0, groupId = sorted[0]?.[2] ?? 0;
  for (const [part, g, group = 0] of sorted) {
    if (group !== groupId) { geo.addGroup(groupStart, idx.length - groupStart, groupId); groupStart = idx.length; groupId = group; }
    const base = pos.length / 3;
    const bone = bones.indexOf(part.group);
    pos.push(...g.attributes.position.array);
    uv.push(...g.attributes.uv.array);
    nor.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(base + i);
    for (let i = 0; i < g.attributes.position.count; i++) { skinIndex.push(bone, 0, 0, 0); skinWeight.push(1, 0, 0, 0); }
    g.dispose();
  }
  if (Array.isArray(material)) geo.addGroup(groupStart, idx.length - groupStart, groupId);
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(skinIndex), 4));
  geo.setAttribute('skinWeight', new BufferAttribute(new Float32Array(skinWeight), 4));
  geo.setIndex(idx);
  const mesh = new SkinnedMesh(geo, material);
  mesh.bind(new Skeleton(bones, bones.map(() => new Matrix4())), new Matrix4());
  // The bones move the model away from any bounds computed once.
  mesh.frustumCulled = false;
  return mesh;
}

// Ray against skinned models: their bounds follow the current pose.
export function refreshBounds(meshes) {
  for (const m of meshes) if (m.isSkinnedMesh) m.boundingSphere = null;
}

/** A model part: pivot (x, y, z) and rotations applied Z, then Y, then X like the game. */
export class Part {
  constructor(name, x = 0, y = 0, z = 0) {
    this.group = new Bone();
    this.group.name = name;
    this.group.rotation.order = 'ZYX';
    this.x = x; this.y = y; this.z = z;
    this.xRot = 0; this.yRot = 0; this.zRot = 0;
    this.base = [x, y, z];
  }
  copyFrom(p) {
    this.x = p.x; this.y = p.y; this.z = p.z;
    this.xRot = p.xRot; this.yRot = p.yRot; this.zRot = p.zRot;
  }
  apply() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(this.xRot, this.yRot, this.zRot);
  }
}

/**
 * entity (world position, yaw) → modelRoot (upright model space in pixels).
 * Matches the renderer's rotate(180 - bodyYaw) · scale(-1, -1, 1) · scale(s) · translate(0, -1.501, 0).
 */
export function entityRig(scale = 1) {
  const entity = new Group();
  const tilt = new Group();
  const modelRoot = new Group();
  modelRoot.rotation.x = Math.PI;
  modelRoot.position.y = 1.501 * scale;
  modelRoot.scale.setScalar(scale / 16);
  entity.add(tilt);
  tilt.add(modelRoot);
  return { entity, tilt, modelRoot };
}

export const wrapDegrees = (a) => {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
};
export const rotLerp = (t, a, b) => a + t * wrapDegrees(b - a);
export const lerp = (t, a, b) => a + (b - a) * t;
export const DEG = Math.PI / 180;
