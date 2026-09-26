// Below «Работа ботов»: a few seconds after the visitor stops scrolling, the page settles on the section
// they stopped at. Its content glides to the middle of the screen; a section taller than the screen
// is lined up by its nearest edge. Nothing happens when no section is close, or while the visitor is busy.
const IDLE = 3000;
const MARGIN = 24;
// Farther than this share of the screen from any resting place: the visitor is reading, leave the page be.
const REACH = 0.5;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function busy() {
  const a = document.activeElement;
  if (a && (a.matches('input, select, textarea') || a.isContentEditable)) return true;
  const sel = window.getSelection?.();
  return !!(sel && !sel.isCollapsed && sel.toString().trim());
}

// enabled(): checked each time (eco mode and reduced motion turn it off).
export function initSectionSnap({ sections, enabled = () => true }) {
  sections = sections.filter(Boolean);
  if (!sections.length) return;
  const header = document.querySelector('.site-header');
  let timer = 0, glide = 0, gliding = false;

  // Resting places for the page: scroll positions where a section sits well on screen.
  function stops() {
    const vh = window.innerHeight;
    const top = header?.offsetHeight ?? 0;
    const avail = vh - top;
    const y = window.scrollY;
    const out = [];
    for (const s of sections) {
      const kids = [...s.children].map((k) => k.getBoundingClientRect()).filter((r) => r.height);
      if (!kids.length) continue;
      const a = kids[0].top + y, b = Math.max(...kids.map((r) => r.bottom)) + y;
      const h = b - a;
      if (h <= avail - 2 * MARGIN) out.push(a - top - (avail - h) / 2);
      else out.push(a - top - MARGIN, b - vh + MARGIN);
    }
    return out;
  }

  function settle() {
    if (!enabled() || document.hidden || busy() || header?.classList.contains('is-open')) return;
    const y = window.scrollY, vh = window.innerHeight;
    const max = document.documentElement.scrollHeight - vh;
    // Only below the bot blocks, and never away from the very bottom (the footer).
    if (y + vh / 2 < sections[0].getBoundingClientRect().top + y || y >= max - 2) return;
    let best = null;
    for (const t of stops()) {
      const to = Math.max(0, Math.min(max, Math.round(t)));
      if (best === null || Math.abs(to - y) < Math.abs(best - y)) best = to;
    }
    if (best === null || Math.abs(best - y) < 2 || Math.abs(best - y) > vh * REACH) return;
    glideTo(best);
  }

  function glideTo(to) {
    const from = window.scrollY;
    const duration = Math.min(900, 350 + Math.abs(to - from) * 0.9);
    let start = 0;
    gliding = true;
    const frame = (now) => {
      if (!gliding) return;
      start ||= now;
      const k = Math.min(1, (now - start) / duration);
      window.scrollTo({ top: from + (to - from) * ease(k), behavior: 'instant' });
      if (k < 1) glide = requestAnimationFrame(frame);
      else gliding = false;
    };
    glide = requestAnimationFrame(frame);
  }

  // Any input of the visitor's own stops the glide at once.
  const stop = () => {
    if (gliding) { gliding = false; cancelAnimationFrame(glide); }
    clearTimeout(timer);
  };
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) addEventListener(type, stop, { passive: true });
  addEventListener('scroll', () => {
    if (gliding) return;
    clearTimeout(timer);
    timer = setTimeout(settle, IDLE);
  }, { passive: true });
}
