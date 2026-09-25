// Block and sky light like the game: levels 0..15 flood through the world, lowered by 1 per step
// (plus the block's opacity), and a lightmap turns the two levels into a colour.
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// How much a block lowers light passing through it: 15 stops it.
export function lightOpacity(m) {
  if (!m || m.kind === 'none') return 0;
  if (m.opaque || m.lightBlock === 15) return 15;
  if (m.kind === 'fluid' && m.fluid === 'water') return 1;
  if (m.water) return 1;
  if (m.kind === 'cube' && m.layer === 'cutout' && !m.cullSame) return 1; // leaves
  return 0;
}

/** grid: { size, get(x, y, z) → palette index }, models[index] → model. Returns per-cell levels. */
export function computeLight(grid, models) {
  const [sx, sy, sz] = grid.size;
  const n = sx * sy * sz;
  const idx = (x, y, z) => (y * sz + z) * sx + x;
  const opacity = new Uint8Array(n);
  const block = new Uint8Array(n);
  const sky = new Uint8Array(n);
  const queue = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const m = models[grid.get(x, y, z)];
    const i = idx(x, y, z);
    opacity[i] = lightOpacity(m);
    if (m?.emit) { block[i] = m.emit; queue.push(i); }
  }
  const spread = (levels, q) => {
    let head = 0;
    while (head < q.length) {
      const i = q[head++];
      const level = levels[i];
      if (level <= 1) continue;
      const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / (sx * sz));
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
        const j = idx(nx, ny, nz);
        if (opacity[j] >= 15) continue;
        const next = level - 1 - opacity[j];
        if (next > levels[j]) { levels[j] = next; q.push(j); }
      }
    }
  };
  spread(block, queue);
  // Sky: full light straight down each open column, then around corners.
  const skyQueue = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    let level = 15;
    for (let y = sy - 1; y >= 0; y--) {
      const i = idx(x, y, z);
      if (opacity[i] >= 15) { level = 0; continue; }
      level = Math.max(0, level - opacity[i]);
      sky[i] = level;
      if (level > 1) skyQueue.push(i);
    }
  }
  // The island floats in open air: light also comes in from beyond the region's sides and bottom.
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (x > 0 && x < sx - 1 && z > 0 && z < sz - 1 && y > 0) continue;
    const i = idx(x, y, z);
    if (opacity[i] >= 15) continue;
    const v = 14 - opacity[i];
    if (v > sky[i]) { sky[i] = v; skyQueue.push(i); }
  }
  spread(sky, skyQueue);
  return {
    block, sky,
    at(x, y, z) {
      if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return [0, 15];
      const i = idx(x, y, z);
      return [block[i], sky[i]];
    },
  };
}

const brightness = (l) => { const f = l / 15; return f / (4 - 3 * f); };

// Night lightmap: warm torchlight (the game's block light curve) plus dim blue moonlight.
export function nightLightmap({ moon = 0.15, lift = 0.08, floor = 0.025 } = {}) {
  return (b, s) => {
    const fb = brightness(b), fs = brightness(s) * moon;
    const warm = [fb, fb * ((fb * 0.6 + 0.4) * 0.6 + 0.4), fb * (fb * fb * 0.6 + 0.4)];
    const cool = [fs * 0.62, fs * 0.72, fs];
    return warm.map((w, i) => {
      let c = Math.min(1, w + cool[i]);
      c = c * (1 - lift) + (1 - (1 - c) ** 4) * lift;
      return Math.min(1, floor + c * (1 - floor));
    });
  };
}
