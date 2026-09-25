// Replays → per-bot loop timelines (public/data/scene.json) and island blocks (public/data/island.json).
// Loop bounds come from source/loops.json; bots missing there get the best candidate written back.
//   node tools/replay-to-timeline.js            use loops.json, fill in missing bots
//   node tools/replay-to-timeline.js --suggest  overwrite loops.json with the best candidates
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { readMcpr } from './lib/mcpr.js';
import { createRegistry, exportIsland } from './lib/world.js';
import { simulate } from './lib/simulate.js';
import { assignZones, zoneTimeline, loopCandidates, loopCost } from './lib/loops.js';
import { encodeBotLoop, Palette, POS_SCALE, ANGLE_SCALE } from './lib/encode.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);

export async function convert({ root = ROOT, suggest = false, write = true, log = console.log } = {}) {
  const src = (p) => path.join(root, 'source', p);
  const scene = readJson(src('scene.json'));
  const { bots } = readJson(src('bots.json'));
  const loopsFile = src('loops.json');
  const loops = suggest ? {} : readJson(loopsFile, {});
  const reg = createRegistry();
  const nicks = bots.map((b) => b.nick);

  const takes = [];
  for (const rel of scene.replays) {
    const name = path.basename(rel, '.mcpr');
    const { meta, packets } = await readMcpr(fs.readFileSync(src(rel)));
    const sim = simulate(packets, { registry: reg, region: scene.region, recorder: scene.recorder, nicks });
    const zones = assignZones(sim);
    const perBot = new Map();
    for (const nick of nicks) {
      const zone = zones.get(nick);
      if (!zone) continue;
      const tl = zoneTimeline(sim, zone);
      perBot.set(nick, { zone, tl, candidates: loopCandidates(reg, tl, { minTicks: 100 }) });
    }
    takes.push({ name, meta, sim, perBot });
  }

  // Island from the first replay; all dynamic block positions stay inside its bounding box.
  const base = takes[0].sim;
  const dynamicByBot = new Map(nicks.map((n) => [n, new Map()]));
  for (const take of takes) for (const [nick, { zone }] of take.perBot) for (const b of zone.blocks) dynamicByBot.get(nick).set(b.key, b.pos);
  const allDynamic = [...dynamicByBot.values()].flatMap((m) => [...m.values()]);
  const nightLights = readNightLights(src('night.json'), base.initialWorld, reg, allDynamic);
  const island = exportIsland(base.initialWorld, { keep: [...allDynamic, ...nightLights.map((l) => l.at)] });

  const palette = new Palette(reg);
  const out = [];
  const chosen = {};
  for (const bot of bots) {
    let pick = loops[bot.nick];
    if (!pick) {
      let best = null;
      for (const take of takes) {
        const c = take.perBot.get(bot.nick)?.candidates[0];
        if (c && (!best || c.score < best.score)) best = { replay: take.name, from: c.from, to: c.to, score: c.score };
      }
      if (!best) throw new Error(`no loop candidate for ${bot.nick}`);
      pick = { replay: best.replay, from: best.from, to: best.to };
    }
    const take = takes.find((t) => t.name === pick.replay);
    if (!take) throw new Error(`${bot.nick}: unknown replay ${pick.replay} in loops.json`);
    const { zone, tl } = take.perBot.get(bot.nick);
    if (pick.from < 0 || pick.to > take.sim.ticks || pick.to - pick.from < 2) throw new Error(`${bot.nick}: bad loop ${pick.from}..${pick.to}`);
    chosen[bot.nick] = { replay: pick.replay, from: pick.from, to: pick.to };
    const dynamic = [...dynamicByBot.get(bot.nick).values()];
    const enc = encodeBotLoop({ sim: take.sim, zone, loop: chosen[bot.nick], origin: island.origin, palette, dynamic });
    out.push({ job: bot.job, ...enc, seam: loopCost(reg, tl, pick.from, pick.to) });
  }

  const sceneJson = {
    version: 1,
    tickRate: 20,
    origin: island.origin,
    posScale: POS_SCALE,
    angleScale: ANGLE_SCALE,
    palette: palette.list,
    bots: out.map(({ seam, ...b }) => b),
  };
  const islandJson = { version: 1, origin: island.origin, size: island.size, order: 'yzx', palette: island.palette, rle: island.rle };
  const nightJson = { version: 1, blocks: nightLights.map(({ at, block }) => [...at.map((v, i) => v - island.origin[i]), block]) };
  const sceneText = JSON.stringify(sceneJson);
  const islandText = JSON.stringify(islandJson);
  const sizes = {
    scene: [sceneText.length, zlib.gzipSync(sceneText, { level: 9 }).length],
    island: [islandText.length, zlib.gzipSync(islandText, { level: 9 }).length],
  };

  const report = buildReport({ takes, bots, chosen, out, island, sizes, reg });
  if (write) {
    const dataDir = path.join(root, 'public/data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'scene.json'), sceneText);
    fs.writeFileSync(path.join(dataDir, 'island.json'), islandText);
    fs.writeFileSync(path.join(dataDir, 'night.json'), JSON.stringify(nightJson));
    fs.writeFileSync(loopsFile, JSON.stringify(chosen, null, 2).replace(/\{\n\s+("replay"[^}]+)\n\s+\}/g, (m, body) => `{ ${body.replace(/\n\s+/g, ' ')} }`) + '\n');
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'reports/replays.md'), report);
  }
  log(`scene.json ${(sizes.scene[0] / 1024).toFixed(1)} KB (gzip ${(sizes.scene[1] / 1024).toFixed(1)} KB), island.json ${(sizes.island[0] / 1024).toFixed(1)} KB (gzip ${(sizes.island[1] / 1024).toFixed(1)} KB)`);
  for (const [nick, c] of Object.entries(chosen)) log(`${nick}: ${c.replay} ticks ${c.from}..${c.to} (${((c.to - c.from) / 20).toFixed(1)} s)`);
  return { scene: sceneJson, island: islandJson, night: nightJson, takes, chosen, report, sizes };
}

// Extra light sources for the night scene (source/night.json), checked against the island.
function readNightLights(file, world, reg, dynamic) {
  if (!fs.existsSync(file)) return [];
  const { lights = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dyn = new Set(dynamic.map((p) => p.join(',')));
  return lights.map(({ block, at }) => {
    const [x, y, z] = at;
    if (!world.contains(x, y, z) || !reg.isAir(world.get(x, y, z)) || dyn.has(at.join(','))) {
      throw new Error(`night.json: ${block} at ${at.join(',')} is not an empty cell of the island`);
    }
    const hanging = /hanging=true/.test(block);
    const support = hanging ? [x, y + 1, z] : [x, y - 1, z];
    if (reg.isAir(world.get(...support))) throw new Error(`night.json: ${block} at ${at.join(',')} has nothing to ${hanging ? 'hang from' : 'stand on'}`);
    return { block, at };
  });
}

function count(list, key) {
  const m = {};
  for (const x of list) { const k = key(x); m[k] = (m[k] || 0) + 1; }
  return m;
}

const fmtCounts = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ') || '—';
const sec = (ticks) => `${(ticks / 20).toFixed(1)} с`;

function buildReport({ takes, bots, chosen, out, island, sizes, reg }) {
  const L = [];
  L.push('# Реплеи → ленты событий', '');
  L.push('Сгенерировано `node tools/replay-to-timeline.js`. Границы циклов правятся в `source/loops.json` (тики по 50 мс от начала записи, `to` не включается).', '');
  L.push('## Записи', '');
  for (const t of takes) {
    L.push(`- **${t.name}**: ${sec(t.sim.ticks)} (${t.sim.ticks} тиков), Minecraft ${t.meta.mcversion}, протокол ${t.meta.protocol}, ${t.meta.generator}. Записывающий игрок отброшен: ${t.sim.skipped.recorder} сущн., посторонние: ${[...t.sim.skipped.strangers].join(', ') || 'нет'}.`);
    for (const b of t.sim.bots) L.push(`  - ${b.nick}: номера сущностей ${b.entityIds.join(' → ')}`);
  }
  L.push('');
  L.push('## Боты', '');
  for (const bot of bots) {
    const c = chosen[bot.nick];
    const enc = out.find((o) => o.nick === bot.nick);
    L.push(`### ${bot.nick} (${bot.job}, скин ${bot.model})`, '');
    L.push(`Взят дубль **${c.replay}**, тики ${c.from}…${c.to} — **${sec(c.to - c.from)}**.`, '');
    const seam = enc.seam;
    L.push(`Стык цикла: стоимость ${seam.total.toFixed(2)} (поза ${seam.pose.toFixed(2)}, взмах ${seam.swing}, блоки ${seam.blocks.toFixed(2)}, трещины ${seam.cracks}, сущности ${seam.entities.toFixed(2)}).`, '');
    const evs = count(enc.events, (e) => (e[1] === 'equip' ? `equip:${e[3]}` : e[1]));
    L.push(`- События бота в цикле: ${fmtCounts(evs)}`);
    L.push(`- Сущности в зоне: ${fmtCounts(count(enc.entities, (e) => e.kind + (e.item ? `:${e.item}` : '')))}`);
    const entEv = count(enc.entities.flatMap((e) => (e.events || []).map((v) => `${e.kind}.${v[1]}${v[3] === 'inferred' ? ' (по исчезновению)' : ''}`)), (x) => x);
    L.push(`- События сущностей: ${fmtCounts(entEv)}`);
    L.push(`- Блоки зоны: ${enc.blocks.init.length} позиций, изменений в цикле ${enc.blocks.changes.length}; стадий трещин ${enc.cracks.length}`);
    L.push(`- Эффекты: ${fmtCounts(count(enc.effects, (e) => (e[1] === 'particle' || e[1] === 'sound' ? `${e[1]}:${e[2]}` : e[1])))}`);
    L.push('- Кандидаты цикла (лучшие по каждому дублю):');
    for (const t of takes) {
      const pb = t.perBot.get(bot.nick);
      for (const k of pb?.candidates ?? []) L.push(`  - ${t.name} ${k.from}…${k.to} (${sec(k.to - k.from)}): стоимость ${k.cost.toFixed(2)} [поза ${k.detail.pose.toFixed(2)}, блоки ${k.detail.blocks.toFixed(2)}, сущности ${k.detail.entities.toFixed(2)}, взмах ${k.detail.swing}]`);
    }
    if (seam.blocks > 0) {
      const t = takes.find((x) => x.name === c.replay);
      const { tl, zone } = t.perBot.get(bot.nick);
      const pops = zone.blocks.map((b, i) => [b.key, tl.blockState[i][c.to], tl.blockState[i][c.from]]).filter((x) => x[1] !== x[2]);
      L.push(`- Скачки блоков на стыке: ${pops.map(([k, a, b]) => `${k}: ${reg.stateString(a)} → ${reg.stateString(b)}`).join('; ')}`);
    }
    L.push('');
  }
  L.push('## Чего нет в записи', '');
  for (const t of takes) {
    const collects = t.sim.entities.reduce((n, e) => n + e.events.filter((v) => v[1] === 'collect').length, 0);
    L.push(`- ${t.name}: пакетов \`collect\` ${collects}.`);
  }
  for (const bot of bots) {
    const enc = out.find((o) => o.nick === bot.nick);
    const items = enc.entities.filter((e) => e.kind === 'item').length;
    const breaks = enc.effects.filter((e) => e[1] === 'break').length;
    if (breaks && !items) L.push(`- ${bot.nick}: ${breaks} разрушений блоков, но ни одного выпавшего предмета.`);
    const inferred = enc.entities.filter((e) => (e.events || []).some((v) => v[3] === 'inferred')).length;
    if (inferred) L.push(`- ${bot.nick}: подбор ${inferred} предметов/опыта восстановлен по исчезновению рядом с ботом.`);
  }
  L.push('');
  L.push('## Остров', '');
  L.push(`Размер ${island.size.join('×')} (X×Y×Z), начало ${island.origin.join(', ')}; блоков ${Object.values(island.counts).reduce((a, b) => a + b, 0)}, состояний в палитре ${island.palette.length}.`, '');
  L.push('| Блок | Кол-во |', '|---|---|');
  for (const [k, v] of Object.entries(island.counts).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push('', `Технические блоки: ${fmtCounts(island.technical)}`, '');
  L.push('## Мобы и предметы во всех записях', '');
  for (const t of takes) {
    L.push(`- ${t.name}: ${fmtCounts(count(t.sim.entities, (e) => e.kind + (e.meta.item ? `:${e.meta.item}` : '')))}`);
    const items = new Set(t.sim.bots.flatMap((b) => b.events.filter((e) => e[1] === 'equip' && e[3]).map((e) => `${b.nick}: ${e[3]}`)));
    L.push(`  - в руках: ${[...items].join(', ')}`);
  }
  L.push('');
  L.push('## Размер данных', '');
  L.push(`- scene.json: ${(sizes.scene[0] / 1024).toFixed(1)} КБ, gzip ${(sizes.scene[1] / 1024).toFixed(1)} КБ`);
  L.push(`- island.json: ${(sizes.island[0] / 1024).toFixed(1)} КБ, gzip ${(sizes.island[1] / 1024).toFixed(1)} КБ`);
  L.push('');
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  convert({ suggest: process.argv.includes('--suggest') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
