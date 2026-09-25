// Creeper model (head 8³, body 8×12×4, four 4×6×4 legs), texture 64×32, quadruped leg swing.
import { MeshLambertMaterial, FrontSide } from 'three';
import { boxGeometry, Part, entityRig, DEG } from './model.js';

export class Creeper {
  constructor({ texture }) {
    Object.assign(this, entityRig(1));
    this.material = new MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: FrontSide });
    // Red hurt/death overlay, mixed like the game's overlay texture (30% red).
    this.material.userData.hurt = { value: 0 };
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uHurt = this.material.userData.hurt;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uHurt;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.0, 0.0), 0.3 * uHurt);');
    };
    const defs = {
      head: [[0, 6, 0], 0, 0, [-4, -8, -4], [8, 8, 8]],
      body: [[0, 6, 0], 16, 16, [-4, 0, -2], [8, 12, 4]],
      leg0: [[-2, 18, 4], 0, 16, [-2, 0, -2], [4, 6, 4]],
      leg1: [[2, 18, 4], 0, 16, [-2, 0, -2], [4, 6, 4]],
      leg2: [[-2, 18, -4], 0, 16, [-2, 0, -2], [4, 6, 4]],
      leg3: [[2, 18, -4], 0, 16, [-2, 0, -2], [4, 6, 4]],
    };
    this.parts = {};
    this.pickables = [];
    for (const [name, [pivot, u, v, o, s]] of Object.entries(defs)) {
      const p = new Part(name, ...pivot);
      this.pickables.push(p.add(boxGeometry(64, 32, u, v, o[0], o[1], o[2], s[0], s[1], s[2]), this.material));
      this.modelRoot.add(p.group);
      this.parts[name] = p;
    }
  }

  setupAnim({ limbSwing = 0, limbSwingAmount = 0, netHeadYaw = 0, headPitch = 0, hurt = 0 }) {
    const { head, leg0, leg1, leg2, leg3 } = this.parts;
    head.yRot = netHeadYaw * DEG;
    head.xRot = headPitch * DEG;
    const a = Math.cos(limbSwing * 0.6662) * 1.4 * limbSwingAmount;
    const b = Math.cos(limbSwing * 0.6662 + Math.PI) * 1.4 * limbSwingAmount;
    leg0.xRot = a; leg1.xRot = b; leg2.xRot = b; leg3.xRot = a;
    for (const p of Object.values(this.parts)) p.apply();
    this.material.userData.hurt.value = hurt;
  }
}
