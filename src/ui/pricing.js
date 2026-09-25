// Price rules from site.config.json → pricing. Pure functions: used by the page renderer and the calculator.

export function ladderTier(cfg, bots) {
  return cfg.ladder.find((t) => bots >= t.from && (t.to == null || bots <= t.to)) ?? cfg.ladder[cfg.ladder.length - 1];
}

// Price of one bot for the term: bulk ladder for a month, flat short-term prices otherwise.
export function pricePerBot(cfg, bots, days) {
  if (days === cfg.monthDays) return ladderTier(cfg, bots).price;
  const t = cfg.shortTerms.find((s) => s.days === days);
  if (!t) throw new Error(`no price for ${days} days`);
  return t.price;
}

/**
 * bots ≥ 1, days: 3/7/14/30, upgrades: ids from cfg.upgrades (per bot), promo / loyalty: booleans.
 * Discounts apply one after another; loyalty only to monthly renewals.
 */
export function quote(cfg, { bots, days, upgrades = [], promo = false, loyalty = false }) {
  const n = Math.max(1, Math.floor(bots));
  const perBot = pricePerBot(cfg, n, days);
  const extras = cfg.upgrades.filter((u) => upgrades.includes(u.id)).reduce((s, u) => s + u.price, 0);
  const full = (perBot + extras) * n;
  let k = 1;
  if (promo) k *= 1 - cfg.promoDiscount;
  if (loyalty && days === cfg.monthDays) k *= 1 - cfg.loyaltyDiscount;
  const total = Math.round(full * k);
  const listPrice = (pricePerBot(cfg, 1, days) + extras) * n;
  return { bots: n, days, perBot, extras, full, total, perBotTotal: Math.round(total / n), save: Math.max(0, listPrice - total) };
}

// Russian-style plural forms: one / few / many (English only uses one / many).
export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms.many;
  if (b > 1 && b < 5) return forms.few;
  if (b === 1) return forms.one;
  return forms.many;
}

export function formatPrice(value, currency, lang) {
  return `${new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(value)} ${currency}`;
}
