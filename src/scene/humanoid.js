// Player model: skin 64×64 with the outer layer, classic or slim arms, and a port of
// HumanoidModel/PlayerModel.setupAnim (walk, arm bob, swing curve, crouch, held item pose).
import { BackSide, DoubleSide, FrontSide, Group, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { boxGeometry, Part, entityRig, DEG } from './model.js';

const PLAYER_SCALE = 0.9375;

// [texU, texV, box origin, box size, inflate]
function layout(slim) {
  const aw = slim ? 3 : 4;
  return {
    head: { pivot: [0, 0, 0], base: [0, 0, [-4, -8, -4], [8, 8, 8]], outer: [32, 0, 0.5] },
    body: { pivot: [0, 0, 0], base: [16, 16, [-4, 0, -2], [8, 12, 4]], outer: [16, 32, 0.25] },
    rightArm: { pivot: [-5, slim ? 2.5 : 2, 0], base: [40, 16, [slim ? -2 : -3, -2, -2], [aw, 12, 4]], outer: [40, 32, 0.25] },
    leftArm: { pivot: [5, slim ? 2.5 : 2, 0], base: [32, 48, [-1, -2, -2], [aw, 12, 4]], outer: [48, 48, 0.25] },
    rightLeg: { pivot: [-1.9, 12, 0], base: [0, 16, [-2, 0, -2], [4, 12, 4]], outer: [0, 32, 0.25] },
    leftLeg: { pivot: [1.9, 12, 0], base: [16, 48, [-2, 0, -2], [4, 12, 4]], outer: [0, 48, 0.25] },
  };
}

export class Humanoid {
  constructor({ skin, slim, outlineColor = 0x58b45e }) {
    this.slim = slim;
    const rig = entityRig(PLAYER_SCALE);
    Object.assign(this, rig);
    const baseMat = new MeshLambertMaterial({ map: skin, alphaTest: 0.5, side: FrontSide });
    const outerMat = new MeshLambertMaterial({ map: skin, alphaTest: 0.5, side: DoubleSide });
    this.materials = [baseMat, outerMat];
    this.outlineMat = new MeshBasicMaterial({ color: outlineColor, side: BackSide });
    this.parts = {};
    this.outlines = [];
    this.pickables = [];
    for (const [name, def] of Object.entries(layout(slim))) {
      const p = new Part(name, ...def.pivot);
      const [u, v, o, s] = def.base;
      const base = p.add(boxGeometry(64, 64, u, v, o[0], o[1], o[2], s[0], s[1], s[2], 0), baseMat);
      p.add(boxGeometry(64, 64, def.outer[0], def.outer[1], o[0], o[1], o[2], s[0], s[1], s[2], def.outer[2]), outerMat);
      const outline = p.add(boxGeometry(64, 64, u, v, o[0], o[1], o[2], s[0], s[1], s[2], def.outer[2] + 0.55), this.outlineMat);
      outline.visible = false;
      outline.renderOrder = -1;
      this.outlines.push(outline);
      this.pickables.push(base);
      this.modelRoot.add(p.group);
      this.parts[name] = p;
    }
    // Held item anchor follows the right arm (translateToHand).
    this.hand = new Group();
    this.handInner = new Group();
    this.handInner.rotation.order = 'XYZ';
    this.handInner.rotation.set(-90 * DEG, 180 * DEG, 0);
    this.handInner.position.set(0, 0, 0);
    this.hand.rotation.order = 'ZYX';
    this.hand.add(this.handInner);
    this.modelRoot.add(this.hand);
    this.itemSlot = new Group();
    this.itemSlot.position.set(1, 2, -10);
    this.handInner.add(this.itemSlot);
    this.heldItem = null;
  }

  setOutline(on) {
    for (const o of this.outlines) o.visible = on;
  }

  setHeldItem(object) {
    if (this.heldItem) this.itemSlot.remove(this.heldItem);
    this.heldItem = object;
    if (object) this.itemSlot.add(object);
  }

  /**
   * limbSwing, limbSwingAmount, ageInTicks, netHeadYaw (deg), headPitch (deg), attackTime (0..1),
   * crouching, holdingItem.
   */
  setupAnim({ limbSwing = 0, limbSwingAmount = 0, ageInTicks = 0, netHeadYaw = 0, headPitch = 0, attackTime = 0, crouching = false, holdingItem = false }) {
    const { head, body, rightArm, leftArm, rightLeg, leftLeg } = this.parts;
    const PI = Math.PI;
    head.yRot = netHeadYaw * DEG;
    head.xRot = headPitch * DEG;
    head.zRot = 0;
    body.yRot = 0;
    rightArm.z = 0; rightArm.x = -5;
    leftArm.z = 0; leftArm.x = 5;
    rightArm.xRot = Math.cos(limbSwing * 0.6662 + PI) * 2 * limbSwingAmount * 0.5;
    leftArm.xRot = Math.cos(limbSwing * 0.6662) * 2 * limbSwingAmount * 0.5;
    rightArm.zRot = 0; leftArm.zRot = 0;
    rightLeg.xRot = Math.cos(limbSwing * 0.6662) * 1.4 * limbSwingAmount;
    leftLeg.xRot = Math.cos(limbSwing * 0.6662 + PI) * 1.4 * limbSwingAmount;
    rightLeg.yRot = 0; leftLeg.yRot = 0; rightLeg.zRot = 0; leftLeg.zRot = 0;
    rightArm.yRot = 0; leftArm.yRot = 0;
    if (holdingItem) rightArm.xRot = rightArm.xRot * 0.5 - PI / 10;

    if (attackTime > 0) {
      let f = attackTime;
      body.yRot = Math.sin(Math.sqrt(f) * PI * 2) * 0.2;
      rightArm.z = Math.sin(body.yRot) * 5;
      rightArm.x = -Math.cos(body.yRot) * 5;
      leftArm.z = -Math.sin(body.yRot) * 5;
      leftArm.x = Math.cos(body.yRot) * 5;
      rightArm.yRot += body.yRot;
      leftArm.yRot += body.yRot;
      leftArm.xRot += body.yRot;
      f = 1 - attackTime;
      f *= f; f *= f;
      f = 1 - f;
      const f1 = Math.sin(f * PI);
      const f2 = Math.sin(attackTime * PI) * -(head.xRot - 0.7) * 0.75;
      rightArm.xRot -= f1 * 1.2 + f2;
      rightArm.yRot += body.yRot * 2;
      rightArm.zRot += Math.sin(attackTime * PI) * -0.4;
    }

    if (crouching) {
      body.xRot = 0.5;
      rightArm.xRot += 0.4; leftArm.xRot += 0.4;
      rightLeg.z = 4; leftLeg.z = 4; rightLeg.y = 12.2; leftLeg.y = 12.2;
      head.y = 4.2; body.y = 3.2; leftArm.y = 5.2; rightArm.y = 5.2;
    } else {
      body.xRot = 0;
      rightLeg.z = 0.1; leftLeg.z = 0.1; rightLeg.y = 12; leftLeg.y = 12;
      head.y = 0; body.y = 0; leftArm.y = 2; rightArm.y = 2;
    }
    // bobArms
    rightArm.zRot += Math.cos(ageInTicks * 0.09) * 0.05 + 0.05;
    leftArm.zRot -= Math.cos(ageInTicks * 0.09) * 0.05 + 0.05;
    rightArm.xRot += Math.sin(ageInTicks * 0.067) * 0.05;
    leftArm.xRot -= Math.sin(ageInTicks * 0.067) * 0.05;

    for (const p of Object.values(this.parts)) p.apply();
    this.hand.position.set(rightArm.x + (this.slim ? 0.5 : 0), rightArm.y, rightArm.z);
    this.hand.rotation.set(rightArm.xRot, rightArm.yRot, rightArm.zRot);
    this.tilt.position.y = crouching ? -0.125 : 0;
  }
}
