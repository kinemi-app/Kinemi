// Decides between the poster and the live WebGL hand, then keeps the viewfinder frame on the fingertips.

const webgl2 = () => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
};

export function initHand() {
  const stage = document.querySelector<HTMLElement>('[data-hand-stage]');
  if (!stage) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const desktop = matchMedia('(pointer: fine) and (min-width: 900px)').matches;
  const frameLater = (ms: number) => setTimeout(() => stage.classList.add('is-framed'), reduce ? 0 : ms);

  let posterShown = false;
  const showPoster = () => {
    if (posterShown) return;
    posterShown = true;
    const img = stage.querySelector('img');
    const go = () => requestAnimationFrame(() => stage.classList.add('show-poster'));
    if (img && !img.complete) img.addEventListener('load', go, { once: true });
    else go();
    frameLater(1300);
  };

  if (reduce || conn?.saveData || !desktop || !webgl2()) {
    showPoster();
    return;
  }

  // Live render: if three.js is slow to arrive, the poster covers for it.
  const fallback = setTimeout(showPoster, 1500);
  import('./hand/scene')
    .then(({ mountHand }) => {
      const intro = !posterShown;
      mountHand(stage, {
        intro,
        onReady() {
          clearTimeout(fallback);
          stage.classList.add('is-live');
          if (intro) frameLater(1750);
          else stage.classList.add('is-framed');
        },
        onTips(t) {
          stage.style.setProperty('--ix', t.index[0].toFixed(4));
          stage.style.setProperty('--iy', t.index[1].toFixed(4));
          stage.style.setProperty('--tx', t.thumb[0].toFixed(4));
          stage.style.setProperty('--ty', t.thumb[1].toFixed(4));
        },
      });
    })
    .catch(() => {
      clearTimeout(fallback);
      showPoster();
    });
}
