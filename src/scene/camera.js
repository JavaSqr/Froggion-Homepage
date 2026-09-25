// Camera: a slow sway around the island for the first screen, close-ups of each station.
import { Vector3 } from 'three';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class CameraRig {
  constructor(camera, { island, decoded }) {
    this.camera = camera;
    const [sx, , sz] = island.size;
    this.center = new Vector3(sx / 2, 19.5, sz / 2);
    this.stations = new Map(decoded.bots.map((b) => [b.nick, this.stationView(b)]));
    this.pos = new Vector3();
    this.target = new Vector3();
    this.mode = 'hero';
    this.time = 0;
    this.transition = null;
    this.aspect = 1;
    this.hero(false);
  }

  resize(w, h) {
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    // Wide screens: shift the island right, away from the headline.
    this.camera.filmOffset = this.aspect > 1.2 ? -Math.min(7, (this.aspect - 1.2) * 9) : 0;
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  heroPose(t) {
    const a = -0.62 + Math.sin(t * 0.12) * 0.22;
    const narrow = this.aspect < 1;
    const r = narrow ? 44 / Math.max(0.55, this.aspect) : 42;
    const pos = new Vector3(this.center.x + Math.sin(a) * r, this.center.y + (narrow ? 19 : 17), this.center.z + Math.cos(a) * r);
    const target = this.center.clone();
    if (narrow) target.y -= 5.5;
    return { pos, target };
  }

  // Close-up of a station, tuned per job for this island: [camera offset, look-at offset] from the bot.
  stationView(b) {
    const presets = {
      mine: [[5, 4.6, -2], [0, 1, 1.2]],
      fish: [[-0.6, 4, 7.5], [-1.6, 0.8, 0]],
      farm: [[4.5, 5, 6.5], [-0.8, 0.6, 0]],
      attack: [[6, 3.2, 0.5], [0, 1.7, -1.1]],
    };
    const [cam, look] = presets[b.job] ?? [[5, 4, 5], [0, 1, 0]];
    const home = new Vector3(...b.home);
    return { pos: home.clone().add(new Vector3(...cam)), target: home.clone().add(new Vector3(...look)) };
  }

  hero(animate) {
    this.mode = 'hero';
    this.go(this.heroPose(this.time), animate);
  }

  focus(nick, animate) {
    const v = this.stations.get(nick);
    if (!v) return;
    this.mode = nick;
    this.go(v, animate);
  }

  go(view, animate) {
    if (animate) this.transition = { from: { pos: this.pos.clone(), target: this.target.clone() }, t: 0 };
    else { this.pos.copy(view.pos); this.target.copy(view.target); this.transition = null; this.apply(); }
  }

  goal() {
    return this.mode === 'hero' ? this.heroPose(this.time) : this.stations.get(this.mode);
  }

  update(dt) {
    this.time += dt;
    const g = this.goal();
    if (this.transition) {
      this.transition.t = Math.min(1, this.transition.t + dt / 1.4);
      const k = ease(this.transition.t);
      this.pos.lerpVectors(this.transition.from.pos, g.pos, k);
      this.target.lerpVectors(this.transition.from.target, g.target, k);
      if (this.transition.t >= 1) this.transition = null;
    } else {
      this.pos.copy(g.pos);
      this.target.copy(g.target);
    }
    this.apply();
  }

  apply() {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }
}
