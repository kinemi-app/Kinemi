// Hero choreography: the pixel letters react to the cursor and the camera timecode runs.
import { pixelField } from './pixel-field';

export function initHero() {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero) return;

  // --- timecode: HH:MM:SS:FF at 24 fps, counting from page load
  const codes = hero.querySelectorAll<HTMLElement>('[data-timecode]');
  if (codes.length) {
    const t0 = performance.now();
    const pad = (n: number) => String(n).padStart(2, '0');
    let visible = true;
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(hero);
    setInterval(() => {
      if (!visible || document.hidden) return;
      const f = Math.floor(((performance.now() - t0) / 1000) * 24);
      const text = `${pad(Math.floor(f / 86400))}:${pad(Math.floor(f / 1440) % 60)}:${pad(Math.floor(f / 24) % 60)}:${pad(f % 24)}`;
      codes.forEach((c) => (c.textContent = text));
    }, 1000 / 12);
  }

  const svg = hero.querySelector<SVGSVGElement>('[data-hero-word] svg');
  if (svg) pixelField(svg, hero, 'push');
}
