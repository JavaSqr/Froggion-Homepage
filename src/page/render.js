// Renders the static pages from content/*.json. Runs in Node (Vite plugin), so all text is in the HTML.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readJson = (root, p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const JOB_ORDER = ['attack', 'fish', 'mine', 'farm'];

export function renderAll(root) {
  const config = readJson(root, 'site.config.json');
  const { bots } = readJson(root, 'source/bots.json');
  const out = {};
  for (const lang of config.languages) {
    const t = readJson(root, `content/${lang.code}.json`);
    const file = lang.path === '/' ? 'index.html' : `${lang.path.replace(/^\/|\/$/g, '')}/index.html`;
    out[file] = renderPage({ t, lang, config, bots });
  }
  return out;
}

function head({ t, lang, config }) {
  const url = config.siteUrl + lang.path;
  const alternates = config.languages
    .map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${config.siteUrl}${l.path}">`)
    .concat(`<link rel="alternate" hreflang="x-default" href="${config.siteUrl}/">`)
    .join('\n    ');
  const locale = lang.code === 'ru' ? 'ru_RU' : 'en_US';
  return `<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${esc(t.meta.title)}</title>
    <meta name="description" content="${esc(t.meta.description)}">
    <link rel="canonical" href="${url}">
    ${alternates}
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Froggion">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${esc(t.meta.title)}">
    <meta property="og:description" content="${esc(t.meta.description)}">
    <meta property="og:image" content="${config.siteUrl}/og.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${esc(t.meta.ogImageAlt)}">
    <meta property="og:locale" content="${locale}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="theme-color" content="#0b0f0c">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="preload" as="image" href="/poster.webp" media="(min-aspect-ratio: 1/1)" fetchpriority="high">
    <link rel="preload" as="image" href="/poster-portrait.webp" media="(max-aspect-ratio: 1/1)" fetchpriority="high">
    <link rel="stylesheet" href="/src/styles/main.css">
    <script type="module" src="/src/main.js"></script>
  </head>`;
}

function header({ t, lang, config }) {
  const nav = [['bots', '#bots'], ['features', '#features'], ['notifications', '#notifications'], ['panel', '#panel'], ['pricing', '#pricing'], ['partners', '#partners'], ['faq', '#faq']];
  const langs = config.languages.map((l) => (l.code === lang.code
    ? `<span class="lang-switch__item is-current" aria-current="true">${l.code.toUpperCase()}</span>`
    : `<a class="lang-switch__item" href="${l.path}" hreflang="${l.hreflang}" lang="${l.hreflang}">${l.code.toUpperCase()}</a>`)).join('');
  return `<header class="site-header">
      <a class="logo" href="${lang.path}" aria-label="Froggion">
        <img src="/brand/logo.png" width="39" height="40" alt="">
        <span>Froggion</span>
      </a>
      <nav class="site-nav" aria-label="${esc(t.nav.label)}">
        <ul>${nav.map(([k, href]) => `<li><a href="${href}">${esc(t.nav[k])}</a></li>`).join('')}</ul>
      </nav>
      <div class="header-actions">
        <div class="lang-switch" role="group" aria-label="${esc(t.nav.language)}">${langs}</div>
        <a class="btn btn--ghost btn--small" href="${esc(config.panelUrl)}">${esc(t.nav.login)}</a>
      </div>
    </header>`;
}

function botsData({ t, bots }) {
  return bots.map((b) => ({
    nick: b.nick,
    slug: b.slug,
    job: b.job,
    model: b.model,
    skin: `/skins/${path.basename(b.skin)}`,
    download: `froggion-${b.slug}-skin.png`,
    name: t.bots[b.nick].name,
    description: t.bots[b.nick].description,
    anchor: `bot-${b.slug}`,
  }));
}

function hero({ t, config, bots }) {
  const list = botsData({ t, bots });
  return `<section class="hero" id="top" aria-labelledby="hero-title">
      <div class="scene-layer" data-scene aria-label="${esc(t.scene.label)}" role="img">
        <picture class="scene-poster">
          <source srcset="/poster-portrait.webp" media="(max-aspect-ratio: 1/1)">
          <img src="/poster.webp" alt="${esc(t.scene.posterAlt)}" fetchpriority="high" decoding="async">
        </picture>
      </div>
      <div class="hero__copy">
        <h1 id="hero-title">${esc(t.hero.title)}</h1>
        <p class="hero__subtitle">${esc(t.hero.subtitle)}</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="${esc(config.panelUrl)}">${esc(t.hero.cta)}</a>
          <a class="btn btn--ghost" href="#pricing">${esc(t.hero.pricing)}</a>
        </div>
        <p class="hero__note">${esc(t.hero.ctaNote)}</p>
      </div>
      <p class="scene-hint" aria-hidden="true">${esc(t.scene.hint)}</p>
      <nav class="bot-list" aria-label="${esc(t.scene.list)}">
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
      <script type="application/json" id="bots-data">${JSON.stringify(list).replace(/</g, '\\u003c')}</script>
    </section>`;
}

function jobs({ t, bots }) {
  const byJob = new Map(bots.map((b) => [b.job, b]));
  return `<section class="jobs" id="bots" aria-labelledby="jobs-title">
      <h2 id="jobs-title">${esc(t.jobs.title)}</h2>
      ${JOB_ORDER.filter((j) => byJob.has(j)).map((j) => {
        const b = byJob.get(j);
        return `<article class="job" id="bot-${b.slug}" data-bot="${b.nick}">
        <h3>${esc(t.jobs[j].title)}</h3>
        <p>${esc(t.jobs[j].text)}</p>
        <p class="job__bot">${esc(t.bots[b.nick].name)}</p>
      </article>`;
      }).join('\n      ')}
    </section>`;
}

export function renderPage(ctx) {
  const { lang } = ctx;
  return `<!doctype html>
<html lang="${lang.code}">
  ${head(ctx)}
  <body>
    <a class="skip-link" href="#main">${lang.code === 'ru' ? 'К содержимому' : 'Skip to content'}</a>
    ${header(ctx)}
    <main id="main">
    ${hero(ctx)}
    ${jobs(ctx)}
    </main>
  </body>
</html>
`;
}
