// Name tags as HTML over the canvas, so the text stays crisp at any distance.
// White text on a dim plate like the game; faded while a block stands between the camera and the bot.
import { Vector3 } from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// The game draws tags 0.025 blocks per font pixel: about 0.22 blocks per line of text.
const LINE = 0.22;

export class NameTags {
  constructor(layer, bots, occludes) {
    this.root = document.createElement('div');
    this.root.className = 'name-tags';
    this.root.setAttribute('aria-hidden', 'true');
    layer.appendChild(this.root);
    this.occludes = occludes;
    this.items = bots.map((bot) => {
      const el = document.createElement('span');
      el.textContent = bot.nick;
      this.root.appendChild(el);
      return { bot, el, size: 0, hidden: null, behind: null };
    });
    this.v = new Vector3();
    this.frame = 0;
  }

  update(camera, width, height) {
    const perUnit = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const checkOcclusion = this.frame++ % 4 === 0;
    for (const it of this.items) {
      const tag = it.bot.tag;
      const p = this.v.copy(tag.position).project(camera);
      const hidden = !tag.visible || p.z > 1 || p.z < -1;
      if (hidden !== it.hidden) { it.el.style.visibility = hidden ? 'hidden' : ''; it.hidden = hidden; }
      if (hidden) continue;
      // Readable far away, not oversized up close.
      const size = Math.round(clamp((LINE * perUnit) / camera.position.distanceTo(tag.position), 12, 22));
      if (size !== it.size) { it.el.style.fontSize = `${size}px`; it.size = size; }
      const x = ((p.x + 1) / 2) * width, y = ((1 - p.y) / 2) * height;
      it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      if (checkOcclusion) {
        const behind = this.occludes(camera.position, tag.position);
        if (behind !== it.behind) { it.el.classList.toggle('is-behind', behind); it.behind = behind; }
      }
    }
  }
}
