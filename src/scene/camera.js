// Camera: a slow sway around the island for the first screen, close-ups of each station,
// and the scroll-driven flight between them (section «Работа ботов»).
import { Vector3 } from 'three';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Share of each leg of the flight during which the camera holds still at a stop.
const HOLD = 0.2;
// On the page the stations are framed a little wider than in the close-up stills: the text card takes a side.
const PATH_PULL = 1.3;

const wrap = (a) => {
  a %= 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

// Between two views the camera arcs around the island centre, rising and backing off in the middle
// of the leg so it clears the tree and shows the island; the gaze slides from one bot to the other.
function blend(a, b, k, center) {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const ra = Math.hypot(a.pos.x - center.x, a.pos.z - center.z);
  const rb = Math.hypot(b.pos.x - center.x, b.pos.z - center.z);
  const ta = Math.atan2(a.pos.x - center.x, a.pos.z - center.z);
  const tb = Math.atan2(b.pos.x - center.x, b.pos.z - center.z);
  const arc = Math.sin(Math.PI * k);
  const r = Math.exp(Math.log(ra) + (Math.log(rb) - Math.log(ra)) * k) + 9 * arc;
  const th = ta + wrap(tb - ta) * k;
  const pos = new Vector3(center.x + Math.sin(th) * r, a.pos.y + (b.pos.y - a.pos.y) * k + 9 * arc, center.z + Math.cos(th) * r);
  const target = a.target.clone().lerp(b.target, k).lerp(center, 0.5 * arc);
  return { pos, target };
}

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
    this.path = [];
    this.flight = { s: -1, goal: -1 };
    this.leap = null;
    this.centered = false;
    this.hero(false);
  }

  resize(w, h) {
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    // Wide screens: shift the island right, away from the headline.
    this.camera.filmOffset = this.aspect > 1.2 && !this.centered ? -Math.min(7, (this.aspect - 1.2) * 9) : 0;
    this.camera.updateProjectionMatrix();
    this.update(0);
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

  // A station as seen on this screen: portrait screens step back to fit it
  // and look lower, so the bot sits above the text card.
  stationPose(nick, pull = 1) {
    const v = this.stations.get(nick);
    if (!v) return v;
    const narrow = this.aspect < 1;
    if (!narrow && pull === 1) return v;
    const off = v.pos.clone().sub(v.target).multiplyScalar(pull * (narrow ? Math.min(2.6, 1.15 / this.aspect) : 1));
    const target = v.target.clone();
    if (narrow) target.y -= off.length() * 0.14;
    return { pos: v.target.clone().add(off), target };
  }

  setPath(nicks) {
    this.path = nicks.filter((n) => this.stations.has(n));
  }

  // s: -1 is the first screen, i is the i-th stop of the path.
  fly(s, instant = false) {
    const goal = clamp(s, -1, this.path.length - 1);
    if (this.mode !== 'path') {
      this.mode = 'path';
      this.transition = null;
      instant = true;
    }
    this.flight.goal = goal;
    if (instant) { this.flight.s = goal; this.update(0); }
  }

  // Straight to a stop, not through the ones before it: from the current view along one arc.
  jump(index) {
    const goal = clamp(index, -1, this.path.length - 1);
    this.mode = 'path';
    this.transition = null;
    this.flight.s = this.flight.goal = goal;
    this.leap = { from: { pos: this.pos.clone(), target: this.target.clone() }, t: 0 };
  }

  pathPose(s) {
    const x = s + 1;
    const i = clamp(Math.floor(x), 0, Math.max(0, this.path.length - 1));
    const view = (j) => (j === 0 ? this.heroPose(this.time) : this.stationPose(this.path[j - 1], PATH_PULL));
    if (!this.path.length) return view(0);
    const k = smooth(clamp((x - i - HOLD) / (1 - 2 * HOLD), 0, 1));
    return blend(view(i), view(i + 1), k, this.center);
  }

  hero(animate) {
    this.mode = 'hero';
    this.go(this.heroPose(this.time), animate);
  }

  focus(nick, animate) {
    const v = this.stationPose(nick);
    if (!v) return;
    this.mode = nick;
    this.go(v, animate);
  }

  go(view, animate) {
    if (animate) this.transition = { from: { pos: this.pos.clone(), target: this.target.clone() }, t: 0 };
    else { this.pos.copy(view.pos); this.target.copy(view.target); this.transition = null; this.apply(); }
  }

  goal() {
    if (this.mode === 'hero') return this.heroPose(this.time);
    if (this.mode === 'path') return this.pathPose(this.flight.s);
    return this.stationPose(this.mode);
  }

  update(dt) {
    this.time += dt;
    // The camera follows the scroll with a little smoothing (touch scrolling comes in bursts).
    const f = this.flight;
    f.s += (f.goal - f.s) * (1 - Math.exp(-dt * 8));
    if (Math.abs(f.goal - f.s) < 1e-4) f.s = f.goal;
    let g = this.goal();
    if (this.leap && this.mode === 'path') {
      this.leap.t = Math.min(1, this.leap.t + dt / 1.6);
      g = blend(this.leap.from, g, ease(this.leap.t), this.center);
      if (this.leap.t >= 1) this.leap = null;
    }
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
