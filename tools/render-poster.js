// Renders the first-screen poster frames (shown until three.js loads, and without WebGL)
// from the built site: public/poster.webp (landscape) and public/poster-portrait.webp.
//   npm run build && node tools/render-poster.js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 4181;
// The moment each bot is caught in: tick of its loop.
const MOMENT = { FroggyMiner: 60, FroggyFisherman: 98, FroggyFarmer: 120, FroggySlayer: 29 };
const FRAMES = [
  { file: 'poster.webp', width: 1600, height: 900 },
  { file: 'poster-portrait.webp', width: 720, height: 1280 },
];

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const f of FRAMES) {
    const page = await browser.newPage({ viewport: { width: f.width, height: f.height }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${PORT}/?poster&motion`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__froggion?.scene?.ready, null, { timeout: 60000 });
    await page.evaluate((moment) => {
      const s = window.__froggion.scene;
      s.freeze(true);
      for (const [nick, tick] of Object.entries(moment)) s.seek(nick, tick);
      s.settle(0);
    }, MOMENT);
    const png = await page.locator('[data-scene]').screenshot();
    const out = path.join(ROOT, 'public', f.file);
    await sharp(png).webp({ quality: 68, effort: 6 }).toFile(out);
    console.log(`${f.file}: ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
