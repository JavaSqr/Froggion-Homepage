import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quote, pricePerBot, plural, ladderTier } from '../../src/ui/pricing.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../../site.config.json', import.meta.url), 'utf8')).pricing;

test('bulk ladder for 30 days', () => {
  assert.deepEqual([1, 2, 4, 5, 9, 10, 50].map((n) => pricePerBot(cfg, n, 30)), [119, 109, 109, 105, 105, 99, 99]);
  assert.equal(ladderTier(cfg, 7).price, 105);
});

test('short terms ignore the bulk ladder', () => {
  assert.equal(pricePerBot(cfg, 10, 3), 29);
  assert.equal(pricePerBot(cfg, 10, 7), 49);
  assert.equal(pricePerBot(cfg, 10, 14), 79);
  assert.throws(() => pricePerBot(cfg, 1, 5));
});

test('quote: totals, upgrades per bot, discounts one after another', () => {
  assert.equal(quote(cfg, { bots: 3, days: 30 }).total, 327);
  assert.equal(quote(cfg, { bots: 1, days: 30, upgrades: ['privateIp'] }).total, 119 + 169);
  const q = quote(cfg, { bots: 10, days: 30, promo: true, loyalty: true });
  assert.equal(q.total, Math.round(990 * 0.85 * 0.9));
  assert.equal(q.save, 1190 - q.total);
  // Loyalty only counts for monthly renewals.
  assert.equal(quote(cfg, { bots: 2, days: 7, loyalty: true }).total, 98);
});

test('Russian plural forms', () => {
  const f = { one: 'бот', few: 'бота', many: 'ботов' };
  assert.deepEqual([1, 2, 4, 5, 11, 21, 22, 25, 101].map((n) => plural(n, f)), ['бот', 'бота', 'бота', 'ботов', 'ботов', 'бот', 'бота', 'ботов', 'бот']);
});
