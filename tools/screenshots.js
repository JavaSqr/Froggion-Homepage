// Screenshots of the built site in headless Chromium (software WebGL).
//   node tools/screenshots.js [out-dir] [shot names...]
// Shots are defined below; each can set a viewport, a URL and a script run on the scene API.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'screenshots'));
const only = process.argv.slice(3);
const PORT = 4179;

// NIGHT=1 takes the same shots of the night variant.
const NIGHT = process.env.NIGHT === '1';
const withVariant = (url) => (NIGHT ? `${url}${url.includes('?') ? '&' : '?'}night` : url);
export const SHOTS = [
  { name: 'first-screen', viewport: [1440, 900], url: '/' },
  { name: 'first-screen-mobile', viewport: [390, 844], url: '/', mobile: true },
  { name: 'station-miner', clean: true, settle: 0, viewport: [1440, 900], url: '/?debug', run: (s) => { s.focusBot('FroggyMiner', false); s.seek('FroggyMiner', 60); } },
  { name: 'station-fisherman', clean: true, settle: 0, viewport: [1440, 900], url: '/?debug', run: (s) => { s.focusBot('FroggyFisherman', false); s.seek('FroggyFisherman', 98); } },
  { name: 'station-farmer', clean: true, settle: 0, viewport: [1440, 900], url: '/?debug', run: (s) => { s.focusBot('FroggyFarmer', false); s.seek('FroggyFarmer', 120); } },
  { name: 'station-slayer', clean: true, settle: 0, viewport: [1440, 900], url: '/?debug', run: (s) => { s.focusBot('FroggySlayer', false); s.seek('FroggySlayer', 29); } },
  { name: 'card-hover', viewport: [1440, 900], url: '/', hover: 'FroggyFisherman' },
  { name: 'card-station', settle: 0, viewport: [1440, 900], url: '/?debug', run: (s) => { s.focusBot('FroggyFarmer', false); s.seek('FroggyFarmer', 200); }, card: 'FroggyFarmer' },
  { name: 'card-mobile', viewport: [390, 844], url: '/', mobile: true, card: 'FroggyMiner' },
  { name: 'en-first-screen', viewport: [1440, 900], url: '/en/' },
  // prefers-reduced-motion: poster only, the card opens from the bot list.
  { name: 'reduced-motion-card', viewport: [1440, 900], url: '/', reducedMotion: true, listCard: 'FroggyFarmer' },
];

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${url} did not start`);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
try {
  await waitForServer(`http://localhost:${PORT}/`);
  fs.mkdirSync(outDir, { recursive: true });
  // CHROMIUM_PATH points at a system Chromium when Playwright's own browser is not installed.
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const shot of SHOTS.filter((s) => !only.length || only.includes(s.name))) {
    const context = await browser.newContext({
      viewport: { width: shot.viewport[0], height: shot.viewport[1] },
      deviceScaleFactor: 1, isMobile: !!shot.mobile, hasTouch: !!shot.mobile,
      reducedMotion: shot.reducedMotion ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${shot.name}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => console.log(`[${shot.name}] pageerror: ${e.message}`));
    await page.goto(`http://localhost:${PORT}${withVariant(shot.url)}`, { waitUntil: 'load' });
    // Close-ups of the scene alone: hide the first-screen copy that sits on top of it.
    if (shot.clean) await page.addStyleTag({ content: '.hero__copy, .scene-hint, .site-header { visibility: hidden !important; }' });
    if (shot.reducedMotion) {
      await page.waitForTimeout(1500);
      const live = await page.evaluate(() => !!document.querySelector('[data-scene] canvas'));
      console.log(`[${shot.name}] live scene: ${live}`);
      if (shot.listCard) await page.click(`.bot-list__btn[data-bot="${shot.listCard}"]`);
      await page.waitForTimeout(200);
      const file = path.join(outDir, `${shot.name}${NIGHT ? '-night' : ''}.png`);
      await page.screenshot({ path: file });
      console.log('saved', path.relative(ROOT, file));
      await context.close();
      continue;
    }
    await page.waitForFunction(() => window.__froggion?.scene?.ready, null, { timeout: 60000 });
    // Stills: stop the clock so the chosen moment is what gets captured.
    await page.evaluate(() => window.__froggion.scene.freeze(true));
    if (shot.run) await page.evaluate(`(${shot.run.toString()})(window.__froggion.scene)`);
    await page.evaluate((settle) => window.__froggion.scene.settle(settle), shot.settle ?? 1.6);
    if (shot.card) await page.evaluate((nick) => window.__froggion.cards.open(nick, { pinned: true, source: 'scene' }), shot.card);
    if (shot.hover) {
      // A real hover: the card must come from the ray pick, not from the API.
      const p = await page.evaluate((nick) => window.__froggion.scene.anchor(nick, -1.5), shot.hover);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__froggion.scene.settle(0));
      const open = await page.evaluate(() => window.__froggion.cards.current);
      console.log(`[${shot.name}] hover opened card: ${open}`);
    }
    await page.evaluate(() => window.__froggion.scene.settle(0));
    await page.waitForTimeout(200);
    const file = path.join(outDir, `${shot.name}${NIGHT ? '-night' : ''}.png`);
    await page.screenshot({ path: file });
    console.log('saved', path.relative(ROOT, file));
    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
