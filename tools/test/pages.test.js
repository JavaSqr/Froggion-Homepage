import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderAll, renderExtras } from '../../src/page/render.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const config = readJson('site.config.json');

// Where the two texts differ in shape: a key or list item missing in one of them.
function shapeDiff(a, b, at = '') {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [`${at}: list in one file only`];
    if (a.length !== b.length) return [`${at}: ${a.length} items vs ${b.length}`];
    return a.flatMap((v, i) => shapeDiff(v, b[i], `${at}[${i}]`));
  }
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => (k in a && k in b ? shapeDiff(a[k], b[k], `${at}.${k}`) : [`${at}.${k}: only in ${k in a ? 'the first' : 'the second'} file`]));
  }
  return typeof a === typeof b ? [] : [`${at}: ${typeof a} vs ${typeof b}`];
}

test('ru.json and en.json have the same keys', () => {
  const [first, ...rest] = config.languages.map((l) => readJson(`content/${l.code}.json`));
  for (const other of rest) assert.deepEqual(shapeDiff(first, other), []);
});

test('pages render every text, with SEO tags', () => {
  const pages = renderAll(ROOT);
  const { bots } = readJson('source/bots.json');
  for (const lang of config.languages) {
    const dir = lang.path.replace(/^\/|\/$/g, '');
    const home = pages[[dir, 'index.html'].filter(Boolean).join('/')];
    assert.ok(home, `home page for ${lang.code}`);
    assert.match(home, new RegExp(`<html lang="${lang.code}"[ >]`));
    assert.match(home, new RegExp(`<link rel="canonical" href="${config.siteUrl}${lang.path}">`));
    for (const l of config.languages) assert.match(home, new RegExp(`hreflang="${l.hreflang}" href="${config.siteUrl}${l.path}"`));
    assert.match(home, /hreflang="x-default"/);
    assert.match(home, /<meta property="og:image" content="https:\/\/[^"]+\.jpg">/);
    for (const b of bots) assert.match(home, new RegExp(`<article class="job" id="bot-${b.slug}" data-bot="${b.nick}"`));
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(home);
    assert.ok(Array.isArray(JSON.parse(ld[1])));
  }
  for (const [file, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /undefined|\[object Object\]|NaN/, `${file} has a missing text`);
    assert.match(html, /<title>[^<]+<\/title>/);
  }
});

test('links that are not live yet lead to the stub page, which search engines skip', () => {
  const pages = renderAll(ROOT);
  const soon = config.comingSoon ?? [];
  for (const lang of config.languages) {
    const dir = lang.path.replace(/^\/|\/$/g, '');
    const home = pages[[dir, 'index.html'].filter(Boolean).join('/')];
    const stub = pages[[dir, 'soon', 'index.html'].filter(Boolean).join('/')];
    assert.ok(stub, `stub page for ${lang.code}`);
    assert.match(stub, /<meta name="robots" content="noindex">/);
    if (soon.includes('panelUrl')) {
      assert.ok(!home.includes(config.panelUrl), 'the panel address is not linked while it is coming soon');
      assert.ok(home.includes(`href="${lang.path}soon/"`));
    }
  }
  assert.ok(!renderExtras(ROOT)['sitemap.xml'].includes('/soon/'));
});

test('in a subfolder (GitHub Pages) links and runtime data carry the prefix', () => {
  const pages = renderAll(ROOT, { base: '/repo/' });
  for (const [file, html] of Object.entries(pages)) {
    const links = [...html.matchAll(/<a [^>]*href="(\/[^"]*)"/g)].map((m) => m[1]);
    assert.ok(links.length, `${file} has links`);
    for (const href of links) assert.ok(href.startsWith('/repo/'), `${file}: ${href}`);
    assert.match(html, /<link rel="manifest" href="\/repo\/site\.webmanifest">/);
  }
  const home = pages['index.html'];
  const bots = JSON.parse(/<script type="application\/json" id="bots-data">(.*?)<\/script>/s.exec(home)[1]);
  for (const b of bots) assert.ok(b.skin.startsWith('/repo/skins/'));
  assert.equal(JSON.parse(renderExtras(ROOT, { base: '/repo/' })['site.webmanifest']).start_url, '/repo/');
});

test('sitemap lists every page in every language', () => {
  const { 'sitemap.xml': sitemap, 'robots.txt': robots } = renderExtras(ROOT);
  for (const l of config.languages) for (const p of ['', 'offer/', 'privacy/']) assert.ok(sitemap.includes(`<loc>${config.siteUrl}${l.path}${p}</loc>`));
  assert.match(robots, /Sitemap: https:\/\/.+\/sitemap\.xml/);
});
