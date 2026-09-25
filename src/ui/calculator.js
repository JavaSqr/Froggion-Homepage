// Pricing calculator «bots × term». Prices and rules come from site.config.json via the page.
import { quote, ladderTier, formatPrice } from './pricing.js';

export function initCalculator(form) {
  const config = form?.querySelector('[data-calc-config]');
  if (!config) return;
  const { cfg, lang } = JSON.parse(config.textContent);
  const money = (v) => formatPrice(v, cfg.currency, lang);
  const { bots: range, botsNumber: number, promo, loyalty } = form.elements;
  const out = Object.fromEntries([...form.querySelectorAll('[data-out]')].map((el) => [el.dataset.out, el]));
  const section = form.closest('section') ?? document;
  const tierRows = [...section.querySelectorAll('tr[data-tier]')];
  const dayRows = [...section.querySelectorAll('tr[data-days]')];
  const maxBots = Number(number.max) || 500;

  const readBots = () => Math.min(maxBots, Math.max(1, Math.floor(Number(number.value)) || 1));

  function render() {
    const bots = readBots();
    const days = Number(form.elements.days.value);
    loyalty.disabled = days !== cfg.monthDays;
    const q = quote(cfg, {
      bots,
      days,
      upgrades: [...form.querySelectorAll('input[name="upgrade"]:checked')].map((i) => i.value),
      promo: promo.checked,
      loyalty: loyalty.checked && !loyalty.disabled,
    });
    out.perBot.textContent = money(q.perBotTotal);
    out.save.textContent = money(q.save);
    out.total.textContent = money(q.total);
    const tier = days === cfg.monthDays ? ladderTier(cfg, bots) : null;
    for (const r of tierRows) r.classList.toggle('is-current', Number(r.dataset.tier) === tier?.from);
    for (const r of dayRows) r.classList.toggle('is-current', Number(r.dataset.days) === days);
  }

  range.addEventListener('input', () => { number.value = range.value; render(); });
  number.addEventListener('input', () => { range.value = String(Math.min(Number(range.max), readBots())); render(); });
  number.addEventListener('change', () => { number.value = String(readBots()); render(); });
  form.addEventListener('change', render);
  form.addEventListener('submit', (e) => e.preventDefault());
  render();
}
