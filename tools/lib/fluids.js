// Lava poured from source blocks the way the game spreads it in the Overworld:
// it falls while the cell below is empty; where it cannot fall it spreads sideways,
// two levels per block (source 0 → 2 → 4 → 6), and only towards the nearest drop if there is one.
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DROP_OFF = 2;
const SLOPE_DISTANCE = 2;

export function pourLava(world, reg, sources) {
  const base = reg.data.blocksByName.lava.minStateId;
  const lavaId = (level) => base + level;
  const empty = (x, y, z) => world.contains(x, y, z) && reg.isAir(world.get(x, y, z));
  const placed = new Map();
  const put = (x, y, z, level) => {
    const key = `${x},${y},${z}`;
    const prev = placed.get(key);
    // A cell keeps the fullest fluid that reaches it (a lower level number is more lava; falling counts as full).
    const amount = (l) => (l >= 8 ? 8 : 8 - l);
    if (prev !== undefined && amount(prev) >= amount(level)) return false;
    placed.set(key, level);
    world.set(x, y, z, lavaId(level));
    return true;
  };
  const canFall = (x, y, z) => empty(x, y - 1, z);

  // Distance to the nearest cell it could fall from, looking a few blocks sideways (as the game does).
  function slopeDistance(x, y, z, depth, from) {
    let best = Infinity;
    for (const [dx, dz] of SIDES) {
      if (from && dx === -from[0] && dz === -from[1]) continue;
      const nx = x + dx, nz = z + dz;
      if (!empty(nx, y, nz)) continue;
      if (empty(nx, y - 1, nz)) return depth;
      if (depth < SLOPE_DISTANCE) best = Math.min(best, slopeDistance(nx, y, nz, depth + 1, [dx, dz]));
    }
    return best;
  }

  const queue = [];
  for (const [x, y, z] of sources) {
    if (!empty(x, y, z)) throw new Error(`lava source at ${x},${y},${z} is not an empty cell`);
    put(x, y, z, 0);
    queue.push([x, y, z, 0]);
  }
  while (queue.length) {
    const [x, y, z, level] = queue.shift();
    if (canFall(x, y, z)) {
      if (put(x, y - 1, z, 8)) queue.push([x, y - 1, z, 8]);
      continue;
    }
    // The region's floor stands for the bottom of the world: the fall ends there.
    if (!world.contains(x, y - 1, z)) continue;
    const amount = (level >= 8 ? 8 : 8 - level) - DROP_OFF;
    if (amount <= 0) continue;
    const options = SIDES.filter(([dx, dz]) => empty(x + dx, y, z + dz) || placed.has(`${x + dx},${y},${z + dz}`))
      .map(([dx, dz]) => ({ dx, dz, d: empty(x + dx, y - 1, z + dz) ? 0 : slopeDistance(x + dx, y, z + dz, 1, [dx, dz]) }));
    const nearest = Math.min(...options.map((o) => o.d));
    for (const o of options) {
      if (nearest !== Infinity && o.d !== nearest) continue;
      const nx = x + o.dx, nz = z + o.dz;
      if (put(nx, y, nz, 8 - amount)) queue.push([nx, y, nz, 8 - amount]);
    }
  }
  return [...placed].map(([key, level]) => [...key.split(',').map(Number), level]);
}
