// «Работа ботов»: the scroll position drives the camera over the island.
// Progress s: -1 on the first screen, i when the i-th job block is centred in the viewport.
const ACTIVE = 0.3;

export function initFlyover({ scene, section }) {
  const jobs = [...(section?.querySelectorAll('.job[data-bot]') ?? [])];
  if (!jobs.length) return;
  scene.setPath(jobs.map((j) => j.dataset.bot));

  let centers = [];
  let active = -1;
  function measure() {
    const y = window.scrollY;
    centers = [window.innerHeight / 2, ...jobs.map((j) => {
      const r = j.getBoundingClientRect();
      return r.top + y + r.height / 2;
    })];
  }

  function progress() {
    const c = window.scrollY + window.innerHeight / 2;
    if (c <= centers[0]) return -1;
    const last = centers.length - 1;
    if (c >= centers[last]) return last - 1;
    let i = 0;
    while (c > centers[i + 1]) i++;
    return i - 1 + (c - centers[i]) / (centers[i + 1] - centers[i]);
  }

  function update(instant = false) {
    const s = progress();
    scene.fly(s, instant);
    const i = Math.round(s);
    const next = i >= 0 && Math.abs(s - i) < ACTIVE ? i : -1;
    if (next === active) return;
    jobs[active]?.classList.remove('is-active');
    jobs[next]?.classList.add('is-active');
    active = next;
  }

  measure();
  update(true);
  const remeasure = () => { measure(); update(); };
  addEventListener('scroll', () => update(), { passive: true });
  addEventListener('resize', remeasure);
  const ro = new ResizeObserver(remeasure);
  ro.observe(section);
  ro.observe(document.documentElement);
}
