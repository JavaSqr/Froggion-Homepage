// Where the island's lava is: pools and streams (for glows), open surfaces (for the game's popping embers)
// and spouts, the cells where a stream leaves the rock (for sparks).
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function lavaLayout(view, fade) {
  const cells = view.emitters.filter((e) => e[4] === 'lava').map(([x, y, z]) => [x, y, z]);
  const key = (x, y, z) => `${x},${y},${z}`;
  const all = new Set(cells.map((c) => key(...c)));
  const isLava = (x, y, z) => all.has(key(x, y, z));
  const alpha = (y) => (fade ? Math.max(0, Math.min(1, (y - fade.y0) / (fade.y1 - fade.y0))) : 1);

  // Connected lava: the generator's pool, each lavafall.
  const seen = new Set();
  const groups = [];
  for (const c of cells) {
    if (seen.has(key(...c))) continue;
    const group = [];
    const stack = [c];
    seen.add(key(...c));
    while (stack.length) {
      const [x, y, z] = stack.pop();
      group.push([x, y, z]);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = [x + dx, y + dy, z + dz];
        if (isLava(...n) && !seen.has(key(...n))) { seen.add(key(...n)); stack.push(n); }
      }
    }
    groups.push(group);
  }

  // Glow points: one over a pool, one every few blocks down a stream, dimmer where the stream fades out.
  const centre = (list) => list.reduce((a, [x, y, z]) => [a[0] + x / list.length, a[1] + y / list.length, a[2] + z / list.length], [0, 0, 0]);
  const glows = [];
  for (const g of groups) {
    const ys = g.map((c) => c[1]);
    const top = Math.max(...ys), bottom = Math.min(...ys);
    if (top - bottom < 3) {
      const [x, y, z] = centre(g);
      glows.push({ at: [x + 0.5, y + 0.9, z + 0.5], strength: 1, pool: true });
      continue;
    }
    for (let y = top; y > bottom; y -= 4) {
      const band = g.filter((c) => c[1] <= y && c[1] > y - 4);
      const [cx, cy, cz] = centre(band);
      const strength = alpha(cy + 0.5);
      if (strength > 0.05) glows.push({ at: [cx + 0.5, cy + 0.5, cz + 0.5], strength, pool: false });
    }
  }

  const surface = cells.filter(([x, y, z]) => view.modelAt(x, y + 1, z)?.kind === 'none');
  // A spout: the top of a stream, open to the side it pours out of.
  const spouts = [];
  for (const [x, y, z] of cells) {
    if (!isLava(x, y - 1, z) || isLava(x, y + 1, z)) continue;
    const open = SIDES.find(([dx, dz]) => view.modelAt(x + dx, y, z + dz)?.kind === 'none');
    if (open) spouts.push({ at: [x + 0.5 + open[0] * 0.45, y + 0.3, z + 0.5 + open[1] * 0.45], dir: open });
  }
  return { glows, surface, spouts };
}

// Per game tick: embers pop out of open lava now and then, sparks fly where lava pours out of the rock.
export function lavaTicker({ surface, spouts }, particles) {
  return () => {
    for (const [x, y, z] of surface) if (Math.random() < 0.006) particles.spawn('lava', [x + 0.5, y + 1, z + 0.5]);
    for (const s of spouts) if (Math.random() < 0.05) particles.spawn('lava', [...s.at]);
  };
}
