import { createCards } from './ui/cards.js';
import { initCalculator } from './ui/calculator.js';
import { initChats } from './ui/chats.js';
import { initFlyover } from './ui/flyover.js';
import { initSmoothWheel } from './ui/smooth-wheel.js';

const layer = document.querySelector('[data-scene]');
const hero = document.querySelector('.hero');
const jobs = document.querySelector('.jobs');
const botsData = JSON.parse(document.getElementById('bots-data')?.textContent || '[]');
const cards = createCards({ bots: botsData, root: hero });
const params = new URLSearchParams(location.search);
const body = document.body;

// site.config.json → motion: "always" keeps the scene and animations on even when the system asks
// for reduced motion; "system" follows that setting. ?still shows the page without motion, ?motion with it.
const motionAlways = document.documentElement.dataset.motion === 'always';
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const still = params.has('still') || (!motionAlways && prefersReduced && !params.has('motion'));

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const lite = matchMedia('(max-width: 760px), (pointer: coarse)').matches || params.has('lite');
if (params.has('poster')) body.classList.add('poster-mode');

// Scene variant: day or night, from site.config.json, overridable with ?night / ?day for comparison.
const variant = params.has('night') ? 'night' : params.has('day') ? 'day' : body.dataset.variant || 'day';
if (layer && variant !== body.dataset.variant) {
  body.dataset.variant = variant;
  const suffix = variant === 'night' ? '-night' : '';
  const img = document.querySelector('.scene-poster img');
  const src = document.querySelector('.scene-poster source');
  if (img) img.src = `${import.meta.env.BASE_URL}poster${suffix}.webp`;
  if (src) src.srcset = `${import.meta.env.BASE_URL}poster${suffix}-portrait.webp`;
  for (const still of document.querySelectorAll('.job__still')) still.src = still.src.replace(/(-night)?\.webp$/, `${suffix}.webp`);
}

// «scene-flight»: the bot blocks stand over the live island. Without it they are a plain list with stills.
let started = false;
async function boot() {
  if (started) return;
  started = true;
  body.classList.remove('scene-paused');
  body.classList.add('scene-flight');
  try {
    const { startScene } = await import('./scene/index.js');
    const scene = await startScene({ layer, bots: botsData, lite, variant, debug: params.has('debug') });
    cards.attachScene(scene);
    if (!body.classList.contains('poster-mode')) initFlyover({ scene, section: jobs });
    body.classList.add('scene-live');
    window.__froggion = { scene, cards };
  } catch (e) {
    // The poster stays; the page works without the 3D scene.
    body.classList.remove('scene-flight');
    console.error('[froggion] 3D scene failed to start:', e);
  }
}

function afterFirstPaint(fn) {
  const run = () => requestAnimationFrame(() => setTimeout(fn, 0));
  if (document.readyState === 'complete') run();
  else addEventListener('load', run, { once: true });
}

// Without WebGL or without motion the poster stays and the bot cards open from the list.
// The visitor can still start the scene with the button.
if (!layer) {
  // no scene on this page
} else if (!webglAvailable()) {
  console.info('[froggion] 3D scene is off: WebGL is not available (is hardware acceleration disabled?)');
} else if (still) {
  console.info('[froggion] 3D scene is off: reduced motion (the system setting with motion "system" in site.config.json, or ?still). Use the button or ?motion.');
  body.classList.add('scene-paused');
  document.querySelector('.scene-play')?.addEventListener('click', boot);
} else {
  body.classList.add('scene-flight');
  afterFirstPaint(boot);
}

// Header: transparent over the first screen, solid once the page scrolls; always solid on pages without it.
const header = document.querySelector('.site-header');
const menuButton = document.querySelector('.menu-btn');
if (header && hero) {
  const sync = () => header.classList.toggle('is-solid', window.scrollY > 24 || header.classList.contains('is-open'));
  addEventListener('scroll', sync, { passive: true });
  sync();
}
if (header && menuButton) {
  const setOpen = (open) => {
    header.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    header.classList.toggle('is-solid', open || window.scrollY > 24 || !hero);
  };
  menuButton.addEventListener('click', () => setOpen(!header.classList.contains('is-open')));
  header.querySelector('.site-nav')?.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && header.classList.contains('is-open')) { setOpen(false); menuButton.focus(); } });
}

initCalculator(document.querySelector('[data-calc]'));
initChats(document.querySelector('[data-chats]'), { reducedMotion: still });
if (!still) initSmoothWheel();
