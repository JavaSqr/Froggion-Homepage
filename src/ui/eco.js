// Eco mode: the switch in the header turns the page's animations off. The choice is kept in this browser;
// a tiny script in <head> applies it before the first paint (the `eco` class on <html>).
const KEY = 'froggion-eco'; // also in the <head> script of src/page/render.js
const root = document.documentElement;
const listeners = new Set();

export const eco = {
  get on() { return root.classList.contains('eco'); },
  set(on) {
    if (on === this.on) return;
    root.classList.toggle('eco', on);
    try {
      if (on) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch { /* storage blocked: the switch still works on this page */ }
    for (const fn of listeners) fn(on);
  },
  onChange(fn) { listeners.add(fn); },
};

export function initEcoToggle() {
  const buttons = [...document.querySelectorAll('.eco-toggle')];
  const sync = () => { for (const b of buttons) b.setAttribute('aria-pressed', String(eco.on)); };
  for (const b of buttons) b.addEventListener('click', () => eco.set(!eco.on));
  eco.onChange(sync);
  sync();
}
