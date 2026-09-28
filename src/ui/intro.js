// Intro of the home page: while the scene loads, a close-up of the moon (a picture in the page, then the
// scene's own moon in its place); once the scene is ready the camera zooms out to the island and the
// header and the headline appear. A script in <head> (src/page/render.js) decides before the first paint
// whether it plays: the `intro` class on <html>. Only on the first visit in a while, never on a reload.
const root = document.documentElement;
// Seconds of the zoom out, and the share of it after which the page's copy appears.
const ZOOM = 3.4;
const REVEAL = 0.55;
// The moon picture is laid over the scene's moon before the zoom starts.
const HANDOVER = 350;

export function createIntro() {
  const active = root.classList.contains('intro');
  let shown = !active;
  // Scrolling or the keyboard: the visitor wants the page now.
  const skip = () => show();
  if (active) {
    addEventListener('scroll', skip, { passive: true });
    addEventListener('keydown', skip);
  }

  function show() {
    if (shown) return;
    shown = true;
    removeEventListener('scroll', skip);
    removeEventListener('keydown', skip);
    root.classList.add('intro-played');
    root.classList.remove('intro');
  }

  // Whether the scene started on the moon (see options).
  let onMoon = false;

  return {
    // Whether the scene should start on the moon, and how large the moon picture is on this screen.
    // Not once the page is shown or scrolled: the scene then starts where the visitor is.
    options(layer) {
      if (window.scrollY > 0) show();
      if (shown) return null;
      onMoon = true;
      const moon = layer.querySelector('.scene-moon img')?.getBoundingClientRect().width;
      return { share: moon ? moon / Math.min(layer.clientWidth, layer.clientHeight) : 0.9 };
    },
    show,
    // The scene is up, looking at the moon: it fades in over the picture, then the zoom out.
    play(scene) {
      if (!onMoon) return;
      if (shown && window.scrollY > 0) { scene.playIntro(0); return; }
      root.classList.add('intro-live');
      setTimeout(() => {
        root.classList.add('intro-zoom');
        scene.playIntro(ZOOM);
        setTimeout(show, ZOOM * REVEAL * 1000);
      }, shown ? 0 : HANDOVER);
    },
  };
}
