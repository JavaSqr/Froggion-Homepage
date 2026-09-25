// Bot card: opens on hover (mouse), click/tap pins it, Esc or a click elsewhere closes it.
// Anchored to a screen point above the bot's head; without a live scene, to the list button.
const HIDE_DELAY = 300;
const MARGIN = 12;

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
  card.tabIndex = -1;

  let scene = null;
  let current = null;
  let pinned = false;
  let hover = null;
  let overCard = false;
  let hideTimer = 0;
  let trigger = null;
  let source = 'scene';

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
    if (current !== nick) { fill(nick); pinned = false; }
    current = nick;
    source = opts.source ?? 'scene';
    if (opts.pinned) pinned = true;
    card.hidden = false;
    position();
    syncHighlight();
  }

  function close({ restoreFocus = false } = {}) {
    clearTimeout(hideTimer);
    if (!current) return;
    current = null;
    pinned = false;
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

  function anchorPoint() {
    if (scene && source !== 'list-static') {
      const a = scene.anchor(current);
      if (a?.visible) return a;
    }
    const btn = listButtons.find((b) => b.dataset.bot === current);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom + 12, below: true };
  }

  function position() {
    if (!current) return;
    const a = anchorPoint();
    if (!a) return;
    const w = card.offsetWidth, h = card.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const header = document.querySelector('.site-header')?.offsetHeight ?? 0;
    let x = a.x - w / 2;
    let y = a.below ? a.y : a.y - h - 10;
    x = Math.max(MARGIN, Math.min(vw - w - MARGIN, x));
    y = Math.max(header + MARGIN, Math.min(vh - h - MARGIN, y));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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
  addEventListener('resize', position);
  addEventListener('scroll', () => {
    if (current && window.scrollY > window.innerHeight * 0.6) close();
    else position();
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
    s.onFrame(position);
  }

  return { attachScene, open, close, get current() { return current; }, get pinned() { return pinned; } };
}
