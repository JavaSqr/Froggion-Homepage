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
      return { bot, el, size: 0, hidden: null, behind: null, rect: null };
    });
    this.v = new Vector3();
    this.frame = 0;
  }

  // exact: check what hides each tag now (single frames), not every few frames.
  // Where a bot's tag is in the layer, or null while it is hidden.
  rect(nick) {
    return this.items.find((it) => it.bot.nick === nick)?.rect ?? null;
  }

  update(camera, width, height, exact = false) {
    const perUnit = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const checkOcclusion = exact || this.frame++ % 4 === 0;
    for (const it of this.items) {
      const tag = it.bot.tag;
      const p = this.v.copy(tag.position).project(camera);
      const hidden = !tag.visible || p.z > 1 || p.z < -1;
      if (hidden !== it.hidden) { it.el.style.visibility = hidden ? 'hidden' : ''; it.hidden = hidden; }
      if (hidden) { it.rect = null; continue; }
      // Readable far away, not oversized up close; whole steps of the pixel font (8px) keep its pixels square.
      const size = 8 * Math.round(clamp((LINE * perUnit) / camera.position.distanceTo(tag.position), 8, 24) / 8);
      if (size !== it.size) {
        it.el.style.fontSize = `${size}px`;
        it.size = size;
        it.w = it.el.offsetWidth;
        it.h = it.el.offsetHeight;
      }
      // Whole device pixels, so the pixel font stays sharp.
      const dpr = window.devicePixelRatio || 1;
      const x = Math.round((((p.x + 1) / 2) * width - it.w / 2) * dpr) / dpr;
      const y = Math.round((((1 - p.y) / 2) * height - it.h) * dpr) / dpr;
      it.el.style.transform = `translate(${x}px, ${y}px)`;
      it.rect = { x, y, w: it.w, h: it.h };
      if (checkOcclusion) {
        const behind = this.occludes(camera.position, tag.position);
        if (behind !== it.behind) { it.el.classList.toggle('is-behind', behind); it.behind = behind; }
      }
    }
  }
}
