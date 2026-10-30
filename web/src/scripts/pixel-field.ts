// Pixel letters that react to the cursor: cells near the pointer push away (hero) or light up (footer).

export function pixelField(svg: SVGSVGElement, area: HTMLElement, mode: 'push' | 'glow' = 'push') {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(pointer: fine)').matches) return;
  const cells = Array.from(svg.querySelectorAll<SVGRectElement>('.px')).map((el) => ({
    el,
    x: Number(el.getAttribute('x')) + 0.5,
    y: Number(el.getAttribute('y')) + 0.5,
    on: false,
  }));
  const vb = svg.viewBox.baseVal;
  let rect = svg.getBoundingClientRect();
  let px = -1e3;
  let py = -1e3;
  let queued = false;
  const R = mode === 'push' ? 3.2 : 2.6; // radius of influence, in cells

  const update = () => {
    queued = false;
    for (const c of cells) {
      const dx = c.x - px;
      const dy = c.y - py;
      const d = Math.hypot(dx, dy);
      if (d < R) {
        const f = (1 - d / R) ** 2;
        if (mode === 'push') {
          const k = (f * 0.45) / Math.max(d, 0.3);
          c.el.style.transform = `translate(${(dx * k).toFixed(3)}px, ${(dy * k).toFixed(3)}px) scale(${(1 - f * 0.18).toFixed(3)})`;
          c.el.style.fillOpacity = (1 - f * 0.35).toFixed(3);
        } else {
          c.el.style.transform = `translateY(${(-f * 0.35).toFixed(3)}px)`;
          c.el.style.fill = f > 0.25 ? '#39d879' : '#1f7f4d';
        }
        c.on = true;
      } else if (c.on) {
        c.el.style.transform = '';
        c.el.style.fillOpacity = '';
        c.el.style.fill = '';
        c.on = false;
      }
    }
  };

  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };

  area.addEventListener(
    'pointermove',
    (e) => {
      // map the pointer into the SVG's units: 1 unit = 1 pixel cell
      const s = vb.width / rect.width;
      px = (e.clientX - rect.left) * s;
      py = (e.clientY - rect.top) * s;
      queue();
    },
    { passive: true },
  );
  area.addEventListener('pointerenter', () => (rect = svg.getBoundingClientRect()));
  area.addEventListener('pointerleave', () => {
    px = py = -1e3;
    queue();
  });
  const refresh = () => (rect = svg.getBoundingClientRect());
  window.addEventListener('resize', refresh, { passive: true });
  window.addEventListener('scroll', refresh, { passive: true });
}
