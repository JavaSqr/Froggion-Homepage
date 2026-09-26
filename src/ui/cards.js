// Bot card: opens on hover (mouse), click/tap pins it, Esc or a click elsewhere closes it.
// It stands beside the bot and its name tag, never over them; without a live scene, under the list button.
import { eco } from './eco.js';

const HIDE_DELAY = 300;
const MARGIN = 12;
const GAP = 12;
// How fast the card catches up with the bot, per second: it glides instead of shaking with every step.
const FOLLOW = 16;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createCards({ bots, root }) {
  const card = root?.querySelector('.bot-card');
  if (!card) return { attachScene() {}, open() {}, close() {} };
  const byNick = new Map(bots.map((b) => [b.nick, b]));
  const title = card.querySelector('.bot-card__title');
  const text = card.querySelector('.bot-card__text');
  const download = card.querySelector('.bot-card__download');
  const more = card.querySelector('.bot-card__more');
  const closeBtn = card.querySelector('.bot-card__close');
  const listButtons = [...root.querySelectorAll('.bot-list__btn')];
  // The list only works with scripts, so it is hidden in the HTML until now.
  root.querySelector('.bot-list')?.removeAttribute('hidden');
  card.tabIndex = -1;

  let scene = null;
  let current = null;
  let pinned = false;
  let hover = null;
  let overCard = false;
  let hideTimer = 0;
  let trigger = null;
  let source = 'scene';
  let goal = null;
  let shown = null;
  let glideFrame = 0;
  let lastGlide = 0;
  let side = null;

  function fill(nick) {
    const b = byNick.get(nick);
    title.textContent = b.name;
    text.textContent = b.description;
    download.href = b.skin;
    download.setAttribute('download', b.download);
    more.href = `#${b.anchor}`;
    card.dataset.bot = nick;
  }

  function syncHighlight() {
    scene?.highlight([current, hover]);
    for (const btn of listButtons) btn.setAttribute('aria-expanded', String(btn.dataset.bot === current));
  }

  function open(nick, opts = {}) {
    if (!byNick.has(nick)) return;
    clearTimeout(hideTimer);
    if (current !== nick) { fill(nick); pinned = false; side = null; }
    current = nick;
    source = opts.source ?? 'scene';
    if (opts.pinned) pinned = true;
    card.hidden = false;
    position(true);
    syncHighlight();
  }

  function close({ restoreFocus = false } = {}) {
    clearTimeout(hideTimer);
    if (!current) return;
    current = null;
    pinned = false;
    shown = goal = side = null;
    card.hidden = true;
    syncHighlight();
    if (restoreFocus && trigger) trigger.focus();
    trigger = null;
  }

  function scheduleHide() {
    if (pinned || !current) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!pinned && !overCard && hover !== current) close();
    }, HIDE_DELAY);
  }

  // Above the bot if there is room, else to its right, left or below. The side sticks while it still fits,
  // so the card does not hop around as the bot walks.
  function beside(b, w, h, box) {
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    const x = clamp(cx - w / 2, box.left, box.right - w);
    const y = clamp(cy - h / 2, box.top, box.bottom - h);
    const spots = {
      above: { x, y: b.top - GAP - h },
      right: { x: b.right + GAP, y },
      left: { x: b.left - GAP - w, y },
      below: { x, y: b.bottom + GAP },
    };
    const fits = (p) => p.x >= box.left && p.y >= box.top && p.x + w <= box.right && p.y + h <= box.bottom;
    for (const s of [side, 'above', 'right', 'left', 'below']) if (s && fits(spots[s])) return { ...spots[s], side: s };
    // No room anywhere around it (a close-up): above, kept on screen.
    return { x, y: clamp(spots.above.y, box.top, box.bottom - h), side: null };
  }

  function target(w, h, box) {
    if (scene && source !== 'list-static') {
      const b = scene.bounds(current);
      if (b?.visible) return beside(b, w, h, box);
    }
    const btn = listButtons.find((l) => l.dataset.bot === current);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: clamp(r.left + r.width / 2 - w / 2, box.left, box.right - w), y: clamp(r.bottom + GAP, box.top, box.bottom - h), side: null };
  }

  // Device-pixel steps: smooth on dense screens, no blurry half pixels.
  function place() {
    const dpr = window.devicePixelRatio || 1;
    card.style.transform = `translate3d(${Math.round(shown.x * dpr) / dpr}px, ${Math.round(shown.y * dpr) / dpr}px, 0)`;
  }

  function glide(now) {
    glideFrame = 0;
    if (!current || !goal || !shown) return;
    const dt = lastGlide ? Math.min(0.05, Math.max(0, (now - lastGlide) / 1000)) : 1 / 60;
    lastGlide = now;
    const k = 1 - Math.exp(-dt * FOLLOW);
    shown.x += (goal.x - shown.x) * k;
    shown.y += (goal.y - shown.y) * k;
    place();
    if (Math.abs(goal.x - shown.x) > 0.05 || Math.abs(goal.y - shown.y) > 0.05) glideFrame = requestAnimationFrame(glide);
  }

  function position(snap = false) {
    if (!current) return;
    const w = card.offsetWidth, h = card.offsetHeight;
    const header = document.querySelector('.site-header')?.offsetHeight ?? 0;
    const box = { left: MARGIN, top: header + MARGIN, right: document.documentElement.clientWidth - MARGIN, bottom: window.innerHeight - MARGIN };
    const t = target(w, h, box);
    if (!t) return;
    side = t.side;
    const { x, y } = t;
    goal = { x, y };
    if (snap || !shown || eco.on) {
      shown = { x, y };
      place();
      return;
    }
    if (!glideFrame) {
      lastGlide = 0;
      glideFrame = requestAnimationFrame(glide);
    }
  }

  // Card hover keeps it open while the cursor travels from the bot to the buttons.
  card.addEventListener('pointerenter', () => { overCard = true; clearTimeout(hideTimer); });
  card.addEventListener('pointerleave', () => { overCard = false; scheduleHide(); });
  closeBtn.addEventListener('click', () => close({ restoreFocus: true }));
  more.addEventListener('click', () => close());

  for (const btn of listButtons) {
    btn.addEventListener('click', () => {
      if (current === btn.dataset.bot && pinned) { close(); return; }
      trigger = btn;
      open(btn.dataset.bot, { pinned: true, source: scene ? 'list' : 'list-static' });
      card.focus({ preventScroll: true });
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) close({ restoreFocus: true });
  });
  document.addEventListener('click', (e) => {
    if (!current) return;
    const t = e.target;
    if (card.contains(t) || listButtons.includes(t) || (scene && t === scene.canvas)) return;
    close();
  });
  addEventListener('resize', () => position(true));
  addEventListener('scroll', () => {
    if (current && window.scrollY > window.innerHeight * 0.6) close();
    else position(true);
  }, { passive: true });

  function attachScene(s) {
    scene = s;
    const canvas = s.canvas;
    let pending = null;
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (pending) { pending = [e.clientX, e.clientY]; return; }
      pending = [e.clientX, e.clientY];
      requestAnimationFrame(() => {
        const [x, y] = pending;
        pending = null;
        const nick = s.pick(x, y);
        canvas.style.cursor = nick ? 'pointer' : '';
        if (nick === hover) return;
        hover = nick;
        if (nick && !pinned) open(nick, { source: 'scene' });
        else if (!nick) scheduleHide();
        syncHighlight();
      });
    });
    canvas.addEventListener('pointerleave', () => { hover = null; canvas.style.cursor = ''; syncHighlight(); scheduleHide(); });
    canvas.addEventListener('click', (e) => {
      const nick = s.pick(e.clientX, e.clientY);
      if (nick) { trigger = null; open(nick, { pinned: true, source: 'scene' }); } else close();
    });
    s.onFrame(() => position());
  }

  return { attachScene, open, close, get current() { return current; }, get pinned() { return pinned; } };
}
