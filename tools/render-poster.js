// Renders the still images of the scene from the built site:
//   public/poster[-night][-portrait].webp  first screen until three.js loads, and without WebGL;
//   public/stations/<slug>[-night].webp    each bot at work, for the «Работа ботов» list without the scene;
//   public/og[-<lang>].jpg                 link preview (Open Graph), one per language.
//   npm run build && node tools/render-poster.js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 4181;
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const { bots } = readJson('source/bots.json');
const config = readJson('site.config.json');
// The moment each bot is caught in: tick of its loop.
const MOMENT = { FroggyMiner: 60, FroggyFisherman: 98, FroggyFarmer: 120, FroggySlayer: 29 };

// Frames grouped by page: one page load per variant and size.
const PAGES = [];
for (const night of [false, true]) {
  const v = night ? '-night' : '';
  PAGES.push({ night, size: [1600, 900], frames: [{ file: `poster${v}.webp` }] });
  PAGES.push({ night, size: [720, 1280], frames: [{ file: `poster${v}-portrait.webp` }] });
  PAGES.push({ night, size: [720, 450], centered: true, frames: bots.map((b) => ({ file: `stations/${b.slug}${v}.webp`, bot: b.nick })) });
}
PAGES.push({
  night: config.scene?.variant === 'night', size: [1200, 630],
  frames: config.languages.map((l) => ({ file: l.path === '/' ? 'og.jpg' : `og-${l.code}.jpg`, overlay: l.code })),
});

// The link preview: logo, name and the first-screen title over the island.
function overlayHtml(lang) {
  const t = readJson(`content/${lang}.json`);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<div style="position:fixed;inset:0;z-index:50;pointer-events:none;
      background:linear-gradient(90deg,rgba(11,15,12,.92) 0%,rgba(11,15,12,.72) 36%,rgba(11,15,12,0) 62%)">
    <div style="position:absolute;left:64px;top:64px;display:flex;align-items:center;gap:16px">
      <img src="/brand/logo.png" width="68" height="70" alt="">
      <span style="font:700 46px/1 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#e9f0e6">Froggion</span>
    </div>
    <h1 style="position:absolute;left:64px;bottom:120px;width:560px;margin:0;font:700 72px/0.98 Handjet,monospace;color:#e9f0e6;text-shadow:0 3px 0 rgba(0,0,0,.45)">${esc(t.hero.title)}</h1>
    <p style="position:absolute;left:64px;bottom:64px;margin:0;font:700 30px/1 Handjet,monospace;color:#d38b34">${esc(t.hero.ctaNote)}</p>
  </div>`;
}

// Vite's own entry run by this Node: no shell, and kill() stops the server itself.
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  fs.mkdirSync(path.join(ROOT, 'public/stations'), { recursive: true });
  for (const p of PAGES) {
    const page = await browser.newPage({ viewport: { width: p.size[0], height: p.size[1] }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${PORT}/?poster&motion&${p.night ? 'night' : 'day'}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__froggion?.scene?.ready, null, { timeout: 60000 });
    await page.evaluate(({ moment, centered }) => {
      const s = window.__froggion.scene;
      s.freeze(true);
      if (centered) s.centerView(true);
      for (const [nick, tick] of Object.entries(moment)) s.seek(nick, tick);
    }, { moment: MOMENT, centered: !!p.centered });
    for (const f of p.frames) {
      await page.evaluate((bot) => {
        const s = window.__froggion.scene;
        if (bot) s.focusBot(bot, false); else s.heroView(false);
        s.settle(0);
      }, f.bot ?? null);
      let image;
      if (f.overlay) {
        await page.evaluate(async (html) => {
          document.getElementById('og-overlay')?.remove();
          const el = document.createElement('div');
          el.id = 'og-overlay';
          el.innerHTML = html;
          document.body.append(el);
          await document.fonts.load('700 72px Handjet', el.textContent);
          await Promise.all([...el.querySelectorAll('img')].map((i) => i.decode()));
        }, overlayHtml(f.overlay));
        image = sharp(await page.screenshot()).jpeg({ quality: 84, mozjpeg: true });
      } else {
        image = sharp(await page.locator('[data-scene]').screenshot()).webp({ quality: 68, effort: 6 });
      }
      const out = path.join(ROOT, 'public', f.file);
      await image.toFile(out);
      console.log(`${f.file}: ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
    }
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
