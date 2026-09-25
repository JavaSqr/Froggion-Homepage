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
  // Without motion (?still, or reduced motion with motion "system"): poster only, the card opens from the bot list.
  { name: 'reduced-motion-card', viewport: [1440, 900], url: '/?still', reducedMotion: true, listCard: 'FroggyFarmer' },
  // The rest of the page. `scroll`: a selector scrolled to the top, or a script returning scrollY.
  { name: 'jobs-intro', viewport: [1440, 900], url: '/', scroll: '#jobs-title', offset: -300 },
  { name: 'jobs-slayer', viewport: [1440, 900], url: '/', scroll: '#bot-slayer' },
  { name: 'jobs-flight', viewport: [1440, 900], url: '/', scroll: () => { const a = document.querySelector('#bot-slayer'), b = document.querySelector('#bot-fisherman'); return (a.offsetTop + b.offsetTop) / 2 + a.offsetParent.offsetTop; } },
  { name: 'jobs-fisherman', viewport: [1440, 900], url: '/', scroll: '#bot-fisherman' },
  { name: 'jobs-miner', viewport: [1440, 900], url: '/', scroll: '#bot-miner' },
  { name: 'jobs-farmer', viewport: [1440, 900], url: '/', scroll: '#bot-farmer' },
  { name: 'jobs-mobile-fisherman', viewport: [390, 844], url: '/', mobile: true, scroll: '#bot-fisherman' },
  { name: 'jobs-reduced-motion', viewport: [1440, 900], url: '/?still', reducedMotion: true, scroll: '#bot-slayer' },
  // «Подробнее» on the Fisherman's card: straight flight to him, mid-way and on arrival.
  { name: 'jump-midway', viewport: [1440, 900], url: '/', settle: 0.7, page: async (p) => {
    await p.evaluate(() => window.__froggion.cards.open('FroggyFisherman', { pinned: true, source: 'scene' }));
    await p.click('.bot-card__more');
  } },
  { name: 'jump-arrived', viewport: [1440, 900], url: '/', settle: 2.2, page: async (p) => {
    await p.evaluate(() => window.__froggion.cards.open('FroggyFisherman', { pinned: true, source: 'scene' }));
    await p.click('.bot-card__more');
  } },
  // The island leaves together with the next section.
  { name: 'stage-leaving', viewport: [1440, 900], url: '/', scroll: '#features', offset: -450 },
  { name: 'features', viewport: [1440, 900], url: '/', scroll: '#features' },
  { name: 'notifications', viewport: [1440, 900], url: '/', scroll: '#notifications', wait: 3500 },
  { name: 'panel', viewport: [1440, 900], url: '/', scroll: '#panel' },
  { name: 'pricing', viewport: [1440, 900], url: '/', scroll: '#pricing', page: async (p) => {
    await p.fill('input[name="botsNumber"]', '12');
    await p.check('input[name="promo"]');
    await p.check('input[value="priorityPool"]');
  } },
  { name: 'partners', viewport: [1440, 900], url: '/', scroll: '#partners' },
  { name: 'faq', viewport: [1440, 900], url: '/', scroll: '#faq', page: (p) => p.click('#faq summary') },
  { name: 'footer', viewport: [1440, 900], url: '/', scroll: () => document.documentElement.scrollHeight },
  { name: 'mobile-pricing', viewport: [390, 844], url: '/', mobile: true, scroll: '.calc' },
  { name: 'mobile-notifications', viewport: [390, 844], url: '/', mobile: true, scroll: '#notifications', wait: 3500 },
  { name: 'mobile-menu', viewport: [390, 844], url: '/', mobile: true, page: (p) => p.click('.menu-btn') },
  { name: 'small-phone', viewport: [360, 740], url: '/', mobile: true },
  { name: 'en-pricing', viewport: [1440, 900], url: '/en/', scroll: '#pricing' },
  { name: 'legal', viewport: [1440, 900], url: '/offer/', static: true },
  { name: 'soon', viewport: [1440, 900], url: '/soon/', static: true },
  { name: 'soon-mobile', viewport: [390, 844], url: '/en/soon/', mobile: true, static: true },
];

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${url} did not start`);
}

// Vite's own entry run by this Node: no shell, and kill() stops the server itself.
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
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
    const scrollTo = async () => {
      if (!shot.scroll) return;
      await page.evaluate(({ sel, fn, offset }) => {
        const y = fn ? (0, eval)(`(${fn})`)() : document.querySelector(sel).getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: y + offset, behavior: 'instant' });
      }, { sel: typeof shot.scroll === 'string' ? shot.scroll : null, fn: typeof shot.scroll === 'function' ? shot.scroll.toString() : null, offset: shot.offset ?? 0 });
      await page.waitForTimeout(150);
    };
    if (shot.static || shot.reducedMotion) {
      await page.waitForTimeout(1500);
      await scrollTo();
      if (shot.page) await shot.page(page);
      if (shot.wait) await page.waitForTimeout(shot.wait);
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
    await scrollTo();
    if (shot.page) await shot.page(page);
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
    await page.waitForTimeout(shot.wait ?? 200);
    const file = path.join(outDir, `${shot.name}${NIGHT ? '-night' : ''}.png`);
    await page.screenshot({ path: file });
    console.log('saved', path.relative(ROOT, file));
    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
