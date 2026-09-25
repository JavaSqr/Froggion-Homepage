import { createCards } from './ui/cards.js';

const layer = document.querySelector('[data-scene]');
const botsData = JSON.parse(document.getElementById('bots-data')?.textContent || '[]');
const cards = createCards({ bots: botsData, root: document.querySelector('.hero') });

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches && !params.has('motion');
const lite = matchMedia('(max-width: 760px), (pointer: coarse)').matches || params.has('lite');
if (params.has('poster')) document.body.classList.add('poster-mode');

// Scene variant: day or night, from site.config.json, overridable with ?night / ?day for comparison.
const variant = params.has('night') ? 'night' : params.has('day') ? 'day' : document.body.dataset.variant || 'day';
if (variant !== document.body.dataset.variant) {
  document.body.dataset.variant = variant;
  const suffix = variant === 'night' ? '-night' : '';
  const img = document.querySelector('.scene-poster img');
  const src = document.querySelector('.scene-poster source');
  if (img) img.src = `/poster${suffix}.webp`;
  if (src) src.srcset = `/poster${suffix}-portrait.webp`;
}

function afterFirstPaint(fn) {
  const run = () => requestAnimationFrame(() => setTimeout(fn, 0));
  if (document.readyState === 'complete') run();
  else addEventListener('load', run, { once: true });
}

if (layer && !reducedMotion && webglAvailable()) {
  afterFirstPaint(async () => {
    const { startScene } = await import('./scene/index.js');
    const scene = await startScene({ layer, bots: botsData, lite, variant, debug: params.has('debug') });
    cards.attachScene(scene);
    document.body.classList.add('scene-live');
    window.__froggion = { scene, cards };
  });
}
