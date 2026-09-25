// Entity model boxes with the game's box UV layout, built in model space (pixels, y down),
// plus the transform that puts model space upright into the world.
import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';

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

/** A model part: pivot (x, y, z) and rotations applied Z, then Y, then X like the game. */
export class Part {
  constructor(name, x = 0, y = 0, z = 0) {
    this.group = new Group();
    this.group.name = name;
    this.group.rotation.order = 'ZYX';
    this.x = x; this.y = y; this.z = z;
    this.xRot = 0; this.yRot = 0; this.zRot = 0;
    this.base = [x, y, z];
  }
  add(geometry, material, extra = {}) {
    const m = new Mesh(geometry, material);
    Object.assign(m.userData, extra);
    this.group.add(m);
    return m;
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
