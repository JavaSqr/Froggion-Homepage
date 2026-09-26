// Renders the static pages from content/*.json. Runs in Node (Vite plugin), so all text is in the HTML.
import fs from 'node:fs';
import path from 'node:path';
import { pricePerBot, plural, formatPrice } from '../ui/pricing.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readJson = (root, p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const JOB_ORDER = ['attack', 'fish', 'mine', 'farm'];

// The site can live in a subfolder (GitHub Pages: BASE_PATH=/repo/). Links and runtime data carry the prefix;
// images and icons in the HTML keep root paths, Vite prefixes those itself.
const normalizeBase = (base = '/') => `/${base}/`.replace(/\/+/g, '/');
const within = (base, p) => base + p.replace(/^\//, '');

// A link from site.config.json; while its key is listed in comingSoon it leads to the stub page.
function link({ config, home }, key) {
  if (config.comingSoon?.includes(key)) return `${home}soon/`;
  const url = key.split('.').reduce((o, k) => o?.[k], config);
  return key === 'contacts.email' ? `mailto:${url}` : url;
}

export function renderAll(root, { base = '/' } = {}) {
  base = normalizeBase(base);
  const config = readJson(root, 'site.config.json');
  const { bots } = readJson(root, 'source/bots.json');
  const out = {};
  for (const lang of config.languages) {
    const t = readJson(root, `content/${lang.code}.json`);
    const dir = lang.path.replace(/^\/|\/$/g, '');
    const file = (p) => [dir, p, 'index.html'].filter(Boolean).join('/');
    const ctx = { t, lang, config, bots, base, home: within(base, lang.path) };
    out[file('')] = renderPage(ctx);
    out[file('offer')] = renderLegal(ctx, 'offer');
    out[file('privacy')] = renderLegal(ctx, 'privacy');
    out[file('soon')] = renderSoon(ctx);
  }
  return out;
}

// Extra files for the built site: sitemap, robots, web manifest.
export function renderExtras(root, { base = '/' } = {}) {
  base = normalizeBase(base);
  const config = readJson(root, 'site.config.json');
  const alternates = (p) => config.languages.map((l) => `<xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${config.siteUrl}${l.path}${p}"/>`).join('');
  const urls = ['', 'offer/', 'privacy/'].flatMap((p) => config.languages.map((l) => `  <url><loc>${config.siteUrl}${l.path}${p}</loc>${alternates(p)}</url>`));
  const ru = readJson(root, 'content/ru.json');
  return {
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`,
    'robots.txt': `User-agent: *\nAllow: /\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`,
    'site.webmanifest': JSON.stringify({
      name: 'Froggion', short_name: 'Froggion', description: ru.meta.description, start_url: base, display: 'standalone',
      background_color: '#0b0f0c', theme_color: '#0b0f0c',
      icons: [{ src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' }, { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' }],
    }, null, 2),
  };
}

// Eco mode (src/ui/eco.js) applied before the first paint, so nothing starts moving and then stops.
const ECO_SCRIPT = "try{if(localStorage.getItem('froggion-eco')==='1')document.documentElement.classList.add('eco')}catch(e){}";

// Link preview image, one per language (tools/render-poster.js).
const ogImage = ({ lang, config }) => `${config.siteUrl}/${lang.path === '/' ? 'og.jpg' : `og-${lang.code}.jpg`}`;

const posterName = (config, portrait) => `/poster${config.scene?.variant === 'night' ? '-night' : ''}${portrait ? '-portrait' : ''}.webp`;

function head({ t, lang, config, base }, { title = t.meta.title, description = t.meta.description, pagePath = '', home = true, index = true } = {}) {
  const url = config.siteUrl + lang.path + pagePath;
  const alternates = config.languages
    .map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${config.siteUrl}${l.path}${pagePath}">`)
    .concat(`<link rel="alternate" hreflang="x-default" href="${config.siteUrl}/${pagePath}">`)
    .join('\n    ');
  const locale = lang.code === 'ru' ? 'ru_RU' : 'en_US';
  const preload = home ? `
    <link rel="preload" as="image" href="${posterName(config, false)}" media="(min-aspect-ratio: 1/1)" fetchpriority="high">
    <link rel="preload" as="image" href="${posterName(config, true)}" media="(max-aspect-ratio: 1/1)" fetchpriority="high">` : '';
  return `<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">${index ? '' : `
    <meta name="robots" content="noindex">`}
    <link rel="canonical" href="${url}">
    ${alternates}
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Froggion">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:image" content="${ogImage({ lang, config })}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${esc(t.meta.ogImageAlt)}">
    <meta property="og:locale" content="${locale}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="theme-color" content="#0b0f0c">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="manifest" href="${base}site.webmanifest">${preload}
    <link rel="stylesheet" href="/src/styles/main.css">
    <script>${ECO_SCRIPT}</script>
    <script type="module" src="/src/main.js"></script>
  </head>`;
}

function header(ctx, prefix = '') {
  const { t, lang, config } = ctx;
  const nav = [['bots', '#bots'], ['features', '#features'], ['notifications', '#notifications'], ['panel', '#panel'], ['pricing', '#pricing'], ['partners', '#partners'], ['faq', '#faq']];
  const langs = config.languages.map((l) => (l.code === lang.code
    ? `<span class="lang-switch__item is-current" aria-current="true">${l.code.toUpperCase()}</span>`
    : `<a class="lang-switch__item" href="${within(ctx.base, l.path)}" hreflang="${l.hreflang}" lang="${l.hreflang}">${l.code.toUpperCase()}</a>`)).join('');
  return `<header class="site-header">
      <a class="logo" href="${ctx.home}" aria-label="Froggion">
        <img src="/brand/logo.png" width="39" height="40" alt="">
        <span>Froggion</span>
      </a>
      <button type="button" class="menu-btn" aria-expanded="false" aria-controls="site-nav" aria-label="${esc(t.nav.menu)}"><span aria-hidden="true"></span></button>
      <nav class="site-nav" id="site-nav" aria-label="${esc(t.nav.label)}">
        <ul>${nav.map(([k, href]) => `<li><a href="${prefix}${href}">${esc(t.nav[k])}</a></li>`).join('')}<li class="site-nav__eco">${ecoToggle(t.nav.ecoMenu, t.nav.ecoHint)}</li></ul>
      </nav>
      <div class="header-actions">
        ${ecoToggle(t.nav.eco, t.nav.ecoHint)}
        <div class="lang-switch" role="group" aria-label="${esc(t.nav.language)}">${langs}</div>
        <a class="btn btn--ghost btn--small" href="${esc(link(ctx, 'panelUrl'))}">${esc(t.nav.login)}</a>
      </div>
    </header>`;
}

// The eco switch (src/ui/eco.js): in the header bar, and inside the menu on the narrowest phones.
function ecoToggle(label, hint) {
  return `<button type="button" class="eco-toggle" aria-pressed="false" title="${esc(hint)}">${pixelIcon('leaf', 16, 'eco-toggle__icon')}<span>${esc(label)}</span></button>`;
}

function botsData({ t, bots, base }) {
  return bots.map((b) => ({
    nick: b.nick,
    slug: b.slug,
    job: b.job,
    model: b.model,
    skin: `${base}skins/${path.basename(b.skin)}`,
    download: `froggion-${b.slug}-skin.png`,
    name: t.bots[b.nick].name,
    description: t.bots[b.nick].description,
    anchor: `bot-${b.slug}`,
  }));
}

// The island stays on screen behind the first screen and the bot blocks, then leaves with the page.
function sceneLayer({ t, config }) {
  return `<div class="scene-layer" data-scene aria-label="${esc(t.scene.label)}" role="img">
        <picture class="scene-poster">
          <source srcset="${posterName(config, true)}" media="(max-aspect-ratio: 1/1)">
          <img src="${posterName(config, false)}" alt="${esc(t.scene.posterAlt)}" fetchpriority="high" decoding="async">
        </picture>
      </div>`;
}

function hero(ctx) {
  const { t, config, bots } = ctx;
  const list = botsData(ctx);
  return `<section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero__copy">
        <h1 id="hero-title">${esc(t.hero.title)}</h1>
        <p class="hero__subtitle">${esc(t.hero.subtitle)}</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="${esc(link(ctx, 'panelUrl'))}">${esc(t.hero.cta)}</a>
          <a class="btn btn--ghost" href="#pricing">${esc(t.hero.pricing)}</a>
        </div>
        <p class="hero__note">${esc(t.hero.ctaNote)}</p>
      </div>
      <p class="scene-hint" aria-hidden="true">${esc(t.scene.hint)}</p>
      <button type="button" class="scene-play">${esc(t.scene.play)}</button>
      <nav class="bot-list" aria-label="${esc(t.scene.list)}" hidden>
        <ul>${list.map((b) => `<li><button type="button" class="bot-list__btn" data-bot="${b.nick}" aria-haspopup="dialog">${esc(b.name)}</button></li>`).join('')}</ul>
      </nav>
      <div class="bot-card" role="dialog" aria-modal="false" aria-labelledby="bot-card-title" hidden>
        <button type="button" class="bot-card__close" aria-label="${esc(t.scene.close)}">×</button>
        <h2 class="bot-card__title" id="bot-card-title"></h2>
        <p class="bot-card__text"></p>
        <div class="bot-card__actions">
          <a class="btn btn--primary btn--small bot-card__download" download>${esc(t.scene.download)}</a>
          <a class="bot-card__more" href="#bots">${esc(t.scene.more)}</a>
        </div>
      </div>
      <script type="application/json" id="bots-data">${json(list)}</script>
    </section>`;
}

// Section 3: the camera flies to each bot while its block is on screen.
function jobs({ t, bots, config }) {
  const byJob = new Map(bots.map((b) => [b.job, b]));
  const night = config.scene?.variant === 'night' ? '-night' : '';
  return `<section class="jobs" id="bots" aria-labelledby="jobs-title">
      <div class="jobs__intro section-head">
        <h2 id="jobs-title">${esc(t.jobs.title)}</h2>
        <p><span class="flight-only">${esc(t.jobs.hint)} </span>${esc(t.jobs.lead)}</p>
      </div>
      ${JOB_ORDER.filter((j) => byJob.has(j)).map((j) => {
        const b = byJob.get(j);
        const job = t.jobs[j];
        return `<article class="job" id="bot-${b.slug}" data-bot="${b.nick}" data-job="${j}" aria-labelledby="job-${j}">
        <div class="job__card pixel-box">
          <p class="job__worker">${esc(t.bots[b.nick].name)}</p>
          <h3 id="job-${j}">${esc(job.title)}</h3>
          <p>${esc(job.text)}</p>
          <ul class="ticks">${job.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        </div>
        <img class="job__still" src="/stations/${b.slug}${night}.webp" width="720" height="450" loading="lazy" decoding="async" alt="${esc(job.title)} — ${esc(t.bots[b.nick].name)}">
      </article>`;
      }).join('\n      ')}
    </section>`;
}

// 12×12 pixel icons, drawn as merged rects.
const ICONS = {
  afk: ['....####....', '..##....##..', '.#...##...#.', '.#...##...#.', '#....##....#', '#....####..#', '#.......#..#', '#..........#', '.#........#.', '.#........#.', '..##....##..', '....####....'],
  reconnect: ['...######...', '..#......#..', '.#........#.', '#......####.', '#........#..', '#...........', '...........#', '..#........#', '.####......#', '.#........#.', '..#......#..', '...######...'],
  schedule: ['..#....#....', '.##########.', '.#........#.', '.##########.', '.#........#.', '.#.##.##..#.', '.#........#.', '.#.##.##..#.', '.#........#.', '.#.##.....#.', '.#........#.', '.##########.'],
  danger: ['.##########.', '.#........#.', '.#...##...#.', '.#...##...#.', '.#...##...#.', '.#...##...#.', '.#........#.', '..#..##..#..', '..#..##..#..', '...#....#...', '....#..#....', '.....##.....'],
  auction: ['....####....', '..##....##..', '..#.####.#..', '..##....##..', '..#.####.#..', '..##....##..', '..#.####.#..', '..##....##..', '..#.####.#..', '..##....##..', '...######...', '............'],
  pickaxe: ['...######...', '.##......##.', '#....##....#', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '............'],
  scripts: ['####........', '#..#........', '####........', '.#..........', '.#..####....', '.###...#....', '....####....', '.....#......', '.....#..####', '.....###...#', '........####', '............'],
  // 8×8, for 16px: the eco switch.
  leaf: ['.....###', '...#####', '..###.##', '.###.###', '.##.####', '.#.####.', '.#####..', '#.......'],
};

function pixelIcon(name, size = 36, cls = 'pixel-icon') {
  const rows = ICONS[name] ?? ICONS.afk;
  const n = rows.length;
  const rects = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') { x++; continue; }
      let w = 0;
      while (row[x + w] === '#') w++;
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1"/>`);
      x += w;
    }
  });
  return `<svg class="${cls}" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true" fill="currentColor">${rects.join('')}</svg>`;
}

function features({ t }) {
  const f = t.features;
  return `<section class="section features" id="features" aria-labelledby="features-title">
      <div class="section-head">
        <h2 id="features-title">${esc(f.title)}</h2>
        <p>${esc(f.lead)}</p>
      </div>
      <ul class="feature-grid">
        ${f.items.map((i) => `<li class="feature pixel-box">${pixelIcon(i.id)}<h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></li>`).join('\n        ')}
      </ul>
      <div class="more">
        <h3>${esc(f.moreTitle)}</h3>
        <ul class="chips">${f.more.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </div>
    </section>`;
}

function notifications({ t }) {
  const n = t.notifications;
  const msg = (kind) => n.messages.find((m) => m.kind === kind);
  const bubble = (text, cls = 'msg--bot') => `<li class="msg ${cls}"><p>${esc(text)}</p><time>${esc(n.now)}</time></li>`;
  const avatar = '<span class="chat__avatar" aria-hidden="true">F</span>';
  const embed = (m) => `<li class="msg msg--embed" data-kind="${m.kind}"><p><b>${esc(n.sender)}</b> <time>${esc(n.now)}</time></p><div class="embed"><p>${esc(m.text)}</p></div></li>`;
  return `<section class="section notifications" id="notifications" aria-labelledby="notifications-title">
      <div class="section-head">
        <h2 id="notifications-title">${esc(n.title)}</h2>
        <p>${esc(n.lead)}</p>
        <ul class="chips chips--kinds">${n.kinds.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>
      </div>
      <div class="chats" data-chats>
        <figure class="chat chat--tg">
          <figcaption class="chat__head">${avatar}<span><b>${esc(n.sender)}</b><small>Telegram</small></span></figcaption>
          <ol class="chat__log">
            ${bubble(msg('join').text)}
            ${bubble(msg('death').text)}
            ${bubble(n.command, 'msg--me')}
            ${bubble(n.reply)}
          </ol>
          <div class="chat__input" aria-hidden="true">${esc(n.input)}</div>
        </figure>
        <figure class="chat chat--vk">
          <figcaption class="chat__head">${avatar}<span><b>${esc(n.sender)}</b><small>VK</small></span></figcaption>
          <ol class="chat__log">
            ${bubble(msg('leave').text)}
            ${bubble(msg('chat').text)}
          </ol>
          <div class="chat__input" aria-hidden="true">${esc(n.input)}</div>
        </figure>
        <figure class="chat chat--ds">
          <figcaption class="chat__head"><span class="chat__hash" aria-hidden="true">#</span><span><b>froggion-alerts</b><small>Discord</small></span></figcaption>
          <ol class="chat__log">
            ${embed(msg('death'))}
            ${embed(msg('join'))}
          </ol>
          <div class="chat__input" aria-hidden="true">${esc(n.input)}</div>
        </figure>
      </div>
    </section>`;
}

function panel(ctx) {
  const { t } = ctx;
  const p = t.panel;
  return `<section class="section panel" id="panel" aria-labelledby="panel-title">
      <div class="section-head">
        <h2 id="panel-title">${esc(p.title)}</h2>
        <p>${esc(p.lead)}</p>
      </div>
      <div class="shots">
        ${p.shots.map((s, i) => `<figure class="shot${i === 0 ? ' shot--main' : ''}">
          <img src="/panel/${s.id}-960.webp" srcset="/panel/${s.id}-560.webp 560w, /panel/${s.id}-960.webp 960w" sizes="(max-width: 760px) 100vw, ${i === 0 ? '60vw' : '35vw'}" width="960" height="508" loading="lazy" decoding="async" alt="${esc(s.alt)}">
          <figcaption>${esc(s.caption)}</figcaption>
        </figure>`).join('\n        ')}
      </div>
      <p class="section-cta"><a class="btn btn--ghost" href="${esc(link(ctx, 'panelUrl'))}">${esc(p.cta)}</a></p>
    </section>`;
}

function pricing(ctx) {
  const { t, lang, config } = ctx;
  const p = t.pricing;
  const cfg = config.pricing;
  const money = (v) => formatPrice(v, cfg.currency, lang.code);
  const botsLabel = (tier) => (tier.to == null ? `${tier.from} ${plural(tier.from, p.bots)} ${p.andMore}` : tier.from === tier.to ? `${tier.from} ${plural(tier.from, p.bots)}` : `${tier.from}–${tier.to} ${plural(tier.to, p.bots)}`);
  const days = (d) => `${d} ${plural(d, p.dayWord)}`;
  const terms = [...cfg.shortTerms.map((s) => s.days), cfg.monthDays];
  const calcData = { cfg, lang: lang.code };
  return `<section class="section pricing" id="pricing" aria-labelledby="pricing-title">
      <div class="section-head">
        <h2 id="pricing-title">${esc(p.title)}</h2>
        <p>${esc(p.lead)}</p>
        <p class="badge">${esc(p.trial)}</p>
      </div>
      <div class="pricing__grid">
        <div class="pricing__tables">
          <div class="price-table pixel-box">
            <h3>${esc(p.ladderTitle)}</h3>
            <table>
              <tbody>
                ${cfg.ladder.map((tier) => `<tr data-tier="${tier.from}"><th scope="row">${esc(botsLabel(tier))}</th><td>${money(tier.price)} <small>${esc(p.perBot)}</small></td></tr>`).join('\n                ')}
              </tbody>
            </table>
          </div>
          <div class="price-table pixel-box">
            <h3>${esc(p.shortTitle)}</h3>
            <table>
              <tbody>
                ${cfg.shortTerms.map((s) => `<tr data-days="${s.days}"><th scope="row">${esc(days(s.days))}</th><td>${money(s.price)} <small>${esc(p.perBot)}</small></td></tr>`).join('\n                ')}
              </tbody>
            </table>
            <p class="note">${esc(p.shortNote)}</p>
          </div>
          <div class="price-extras">
            <div>
              <h3>${esc(p.discountsTitle)}</h3>
              <ul class="ticks"><li>${esc(p.promo)}</li><li>${esc(p.loyalty)}</li></ul>
            </div>
            <div>
              <h3>${esc(p.upgradesTitle)}</h3>
              <ul class="ticks">${cfg.upgrades.map((u) => `<li>${esc(p.upgrades[u.id])} — ${money(u.price)}</li>`).join('')}</ul>
            </div>
          </div>
          <ul class="chips">${p.included.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        </div>
        <form class="calc pixel-box" data-calc aria-labelledby="calc-title">
          <h3 id="calc-title">${esc(p.calc.title)}</h3>
          <div class="calc__row calc__row--inline">
            <label for="calc-bots">${esc(p.calc.bots)}</label>
            <div class="calc__bots"><input id="calc-bots" name="bots" type="range" min="1" max="50" value="1"><input name="botsNumber" type="number" min="1" max="500" value="1" inputmode="numeric" aria-label="${esc(p.calc.bots)}"></div>
          </div>
          <fieldset class="calc__row"><legend>${esc(p.calc.term)}</legend>
            <div class="segmented">${terms.map((d) => `<label><input type="radio" name="days" value="${d}"${d === cfg.monthDays ? ' checked' : ''}><span>${esc(days(d))}</span></label>`).join('')}</div>
          </fieldset>
          <fieldset class="calc__row"><legend>${esc(p.calc.upgrades)}</legend>
            ${cfg.upgrades.map((u) => `<label class="check"><input type="checkbox" name="upgrade" value="${u.id}"><span>${esc(p.upgrades[u.id])} <small>+${money(u.price)}</small></span></label>`).join('')}
          </fieldset>
          <fieldset class="calc__row">
            <label class="check"><input type="checkbox" name="promo"><span>${esc(p.calc.promo)} <small>−${Math.round(cfg.promoDiscount * 100)}%</small></span></label>
            <label class="check"><input type="checkbox" name="loyalty"><span>${esc(p.calc.loyalty)} <small>−${Math.round(cfg.loyaltyDiscount * 100)}%, ${esc(p.calc.loyaltyHint)}</small></span></label>
          </fieldset>
          <div class="calc__result" aria-live="polite">
            <dl class="calc__lines">
              <div><dt>${esc(p.calc.perBot)}</dt><dd data-out="perBot">${money(pricePerBot(cfg, 1, cfg.monthDays))}</dd></div>
              <div><dt>${esc(p.calc.save)}</dt><dd data-out="save">${money(0)}</dd></div>
            </dl>
            <div class="calc__foot">
              <dl class="calc__total"><div><dt>${esc(p.calc.total)}</dt><dd data-out="total">${money(pricePerBot(cfg, 1, cfg.monthDays))}</dd></div></dl>
              <a class="btn btn--primary" href="${esc(link(ctx, 'panelUrl'))}">${esc(p.calc.cta)}</a>
            </div>
          </div>
          <noscript><p class="note">${esc(p.calc.noscript)}</p></noscript>
          <script type="application/json" data-calc-config>${json(calcData)}</script>
        </form>
      </div>
    </section>`;
}

function partners(ctx) {
  const { t } = ctx;
  const p = t.partners;
  return `<section class="section partners" id="partners" aria-labelledby="partners-title">
      <div class="section-head">
        <h2 id="partners-title">${esc(p.title)}</h2>
        <p>${esc(p.lead)}</p>
      </div>
      <ul class="partner-grid">
        ${p.points.map((pt) => `<li class="pixel-box"><h3>${esc(pt.title)}</h3><p>${esc(pt.text)}</p></li>`).join('\n        ')}
      </ul>
      <p class="section-cta"><a class="btn btn--primary" href="${esc(link(ctx, 'partnersUrl'))}">${esc(p.cta)}</a></p>
    </section>`;
}

function faq({ t }) {
  return `<section class="section faq" id="faq" aria-labelledby="faq-title">
      <div class="section-head"><h2 id="faq-title">${esc(t.faq.title)}</h2></div>
      <div class="faq__list">
        ${t.faq.items.map((i) => `<details class="pixel-box"><summary>${esc(i.q)}</summary><p>${esc(i.a)}</p></details>`).join('\n        ')}
      </div>
    </section>`;
}

function finalCta(ctx) {
  const { t } = ctx;
  return `<section class="final-cta" aria-labelledby="cta-title">
      <h2 id="cta-title">${esc(t.cta.title)}</h2>
      <p>${esc(t.cta.text)}</p>
      <a class="btn btn--primary" href="${esc(link(ctx, 'panelUrl'))}">${esc(t.cta.button)}</a>
    </section>`;
}

// The pixel font's credit, as its license (CC BY-SA 3.0) asks; see src/fonts/LICENSE.txt.
const FONT = {
  name: 'Minecraft 1.1', author: 'Pwnage_Block', url: 'https://fontstruct.com/fontstructions/show/432966',
  license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
};

function footer(ctx) {
  const { t, lang, config } = ctx;
  const f = t.footer;
  const c = config.contacts;
  const langs = config.languages.map((l) => `<a href="${within(ctx.base, l.path)}" hreflang="${l.hreflang}" lang="${l.hreflang}"${l.code === lang.code ? ' aria-current="true"' : ''}>${l.code.toUpperCase()}</a>`).join(' · ');
  return `<footer class="site-footer">
      <div class="site-footer__grid">
        <div>
          <a class="logo" href="${ctx.home}" aria-label="Froggion"><img src="/brand/logo.png" width="39" height="40" alt=""><span>Froggion</span></a>
          <p class="site-footer__langs">${langs}</p>
        </div>
        <div>
          <h2>${esc(f.contacts)}</h2>
          <ul>
            <li><a href="${esc(link(ctx, 'contacts.telegram'))}">${esc(f.telegram)}</a></li>
            <li><a href="${esc(link(ctx, 'contacts.vk'))}">${esc(f.vk)}</a></li>
            <li><a href="${esc(link(ctx, 'contacts.email'))}">${esc(c.email)}</a></li>
          </ul>
        </div>
        <div>
          <h2>${esc(f.docs)}</h2>
          <ul>
            <li><a href="${ctx.home}offer/">${esc(f.offer)}</a></li>
            <li><a href="${ctx.home}privacy/">${esc(f.privacy)}</a></li>
          </ul>
        </div>
      </div>
      <p class="site-footer__legal" lang="en">${esc(f.disclaimer)}</p>
      <p class="site-footer__legal">${esc(f.font.label)}: <a href="${FONT.url}">${FONT.name}</a>, ${esc(f.font.by)} ${FONT.author}, ${esc(f.font.license)} <a href="${FONT.licenseUrl}" rel="license">${FONT.license}</a>.</p>
      <p class="site-footer__copy">${esc(f.copyright)}</p>
    </footer>`;
}

function structuredData({ t, lang, config }) {
  const cfg = config.pricing;
  const data = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Froggion', url: config.siteUrl, logo: `${config.siteUrl}/icon-512.png` },
    {
      '@context': 'https://schema.org', '@type': 'Product', name: 'Froggion', description: t.meta.description, image: ogImage({ lang, config }),
      offers: { '@type': 'AggregateOffer', priceCurrency: 'RUB', lowPrice: Math.min(...cfg.shortTerms.map((s) => s.price)), highPrice: Math.max(...cfg.ladder.map((l) => l.price)), offerCount: cfg.ladder.length + cfg.shortTerms.length, url: `${config.siteUrl}${lang.path}#pricing` },
    },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: t.faq.items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })) },
  ];
  return `<script type="application/ld+json">${json(data)}</script>`;
}

export function renderPage(ctx) {
  const { lang } = ctx;
  return `<!doctype html>
<html lang="${lang.code}" data-motion="${ctx.config.motion ?? 'system'}">
  ${head(ctx)}
  <body data-variant="${ctx.config.scene?.variant ?? 'day'}">
    <a class="skip-link" href="#main">${esc(ctx.t.nav.skip)}</a>
    ${header(ctx)}
    <main id="main">
    <div class="stage">
    ${sceneLayer(ctx)}
    ${hero(ctx)}
    ${jobs(ctx)}
    </div>
    ${features(ctx)}
    ${notifications(ctx)}
    ${panel(ctx)}
    ${pricing(ctx)}
    ${partners(ctx)}
    ${faq(ctx)}
    ${finalCta(ctx)}
    </main>
    ${footer(ctx)}
    ${structuredData(ctx)}
  </body>
</html>
`;
}

// Offer and privacy policy: placeholders until the documents are ready.
export function renderLegal(ctx, kind) {
  const { t, lang } = ctx;
  const title = `${t.legal[kind]} — Froggion`;
  return `<!doctype html>
<html lang="${lang.code}" data-motion="${ctx.config.motion ?? 'system'}">
  ${head(ctx, { title, description: t.legal.stub, pagePath: `${kind}/`, home: false })}
  <body class="legal-page">
    <a class="skip-link" href="#main">${esc(t.nav.skip)}</a>
    ${header(ctx, ctx.home)}
    <main id="main" class="legal">
      <h1>${esc(t.legal[kind])}</h1>
      <p>${esc(t.legal.stub)}</p>
      <p><a class="btn btn--ghost" href="${ctx.home}">${esc(t.legal.back)}</a></p>
    </main>
    ${footer(ctx)}
  </body>
</html>
`;
}

// Where links lead while the thing behind them is not live yet (site.config.json → comingSoon).
export function renderSoon(ctx) {
  const { t, lang, config } = ctx;
  return `<!doctype html>
<html lang="${lang.code}" data-motion="${config.motion ?? 'system'}">
  ${head(ctx, { title: `${t.soon.title} — Froggion`, description: t.soon.meta, pagePath: 'soon/', home: false, index: false })}
  <body class="soon-page">
    <a class="skip-link" href="#main">${esc(t.nav.skip)}</a>
    ${header(ctx, ctx.home)}
    <main id="main" class="soon" style="--poster: url('${posterName(config, false)}')">
      <div class="soon__card pixel-box">
        ${pixelIcon('pickaxe', 48)}
        <h1>${esc(t.soon.title)}</h1>
        <p>${esc(t.soon.text)}</p>
        <a class="btn btn--primary" href="${ctx.home}">${esc(t.soon.home)}</a>
      </div>
    </main>
    ${footer(ctx)}
  </body>
</html>
`;
}
