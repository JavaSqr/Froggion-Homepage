// Smooth scrolling for mouse wheels only: a wheel moves the page in notches, here each notch glides.
// Touchpads and touch screens already scroll smoothly, so they keep the browser's own scrolling.
const EASE = 10; // how fast the page catches up with the wheel, per second

function isMouseWheel(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !e.deltaY) return false;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return false;
  // Firefox reports wheel notches in lines, touchpads in pixels.
  if (e.deltaMode === 1) return true;
  if (e.deltaMode !== 0) return false;
  // Chromium and Safari: a notch is a multiple of 120 in wheelDelta; touchpads send small uneven steps.
  const wd = e.wheelDeltaY;
  return typeof wd === 'number' && wd !== 0 && wd % 120 === 0 && Math.abs(e.deltaY) >= 50;
}

// A scrollable box under the cursor keeps the wheel for itself.
function scrollableParent(el) {
  for (let n = el; n instanceof Element && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

export function initSmoothWheel() {
  let target = 0, current = 0, last = 0, active = false;
  const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

  function frame(now) {
    // rAF time can be a little older than the wheel event that started the glide.
    const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    // The page was moved some other way (scrollbar, keys, a link): let it be.
    if (Math.abs(window.scrollY - current) > 2) { active = false; return; }
    current += (target - current) * (1 - Math.exp(-dt * EASE));
    if (Math.abs(target - current) < 0.5) current = target;
    window.scrollTo({ top: current, behavior: 'instant' });
    if (current !== target) requestAnimationFrame(frame);
    else active = false;
  }

  addEventListener('wheel', (e) => {
    if (e.defaultPrevented || !isMouseWheel(e) || scrollableParent(e.target)) return;
    e.preventDefault();
    if (!active) current = target = window.scrollY;
    const step = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    target = Math.max(0, Math.min(maxScroll(), target + step));
    if (!active) {
      active = true;
      last = 0;
      requestAnimationFrame(frame);
    }
  }, { passive: false });
}
