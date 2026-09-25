// Notification mockups: when the section comes into view, the bot's messages arrive one by one.
const STEP = 650;

export function initChats(root, { reducedMotion = false } = {}) {
  if (!root || reducedMotion || !('IntersectionObserver' in window)) return;
  const chats = [...root.querySelectorAll('.chat')];
  const logs = chats.map((c) => [...c.querySelectorAll('.msg')]);
  for (const list of logs) for (const m of list) m.classList.add('is-hidden');
  root.classList.add('is-waiting');

  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    root.classList.remove('is-waiting');
    // The chats play side by side, each message a beat after the previous one.
    logs.forEach((list, c) => list.forEach((m, i) => {
      setTimeout(() => m.classList.remove('is-hidden'), 200 + c * 220 + i * STEP);
    }));
  }, { threshold: 0.35 });
  io.observe(root);
}
