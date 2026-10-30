// Page-wide interactions. Small on purpose: each block only touches elements that opt in.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

/* ---------- reveal on scroll ---------- */
function initReveal() {
  const els = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  els.forEach((el) => io.observe(el));
}

/* ---------- numbers count up when they come into view ---------- */
function initCounters() {
  const els = document.querySelectorAll<HTMLElement>('[data-count]');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const el = e.target as HTMLElement;
        const to = Number(el.dataset.count);
        if (reduce) {
          el.textContent = String(to);
          continue;
        }
        const t0 = performance.now();
        const dur = 1400;
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / dur);
          el.textContent = String(Math.round(to * (1 - (1 - t) ** 4)));
          if (t < 1) requestAnimationFrame(step);
        };
        el.textContent = '0';
        requestAnimationFrame(step);
      }
    },
    { threshold: 0.6 },
  );
  els.forEach((el) => io.observe(el));
}

/* ---------- nav: glass on scroll, hide on the way down, scrollspy pill ---------- */
function initNav() {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!nav) return;
  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('[data-spy]'));
  const pill = nav.querySelector<HTMLElement>('.nav-pill');
  const holder = pill?.parentElement;

  let lastY = window.scrollY;
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = window.scrollY;
    nav.classList.toggle('is-scrolled', y > 24);
    if (y > 520 && y > lastY + 6) nav.classList.add('is-hidden');
    else if (y < lastY - 6 || y <= 520) nav.classList.remove('is-hidden');
    if (Math.abs(y - lastY) > 6) lastY = y;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true },
  );
  onScroll();

  const movePill = (a: HTMLElement | undefined) => {
    if (!pill || !holder || !a) return;
    const h = holder.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    pill.style.setProperty('--pill-x', `${r.left - h.left}px`);
    pill.style.setProperty('--pill-w', `${r.width}px`);
    pill.style.setProperty('--pill-o', '1');
  };

  let active = links[0];
  const setActive = (a: HTMLAnchorElement) => {
    active = a;
    links.forEach((l) => l.classList.toggle('is-active', l === a));
    movePill(a);
  };
  links.forEach((l) => {
    l.addEventListener('pointerenter', () => movePill(l));
    l.addEventListener('focus', () => movePill(l));
  });
  holder?.addEventListener('pointerleave', () => movePill(active));
  window.addEventListener('resize', () => movePill(active), { passive: true });

  const targets = links
    .map((l) => document.getElementById(l.dataset.spy!))
    .filter((t): t is HTMLElement => !!t);
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const link = links.find((l) => l.dataset.spy === e.target.id);
          if (link) setActive(link);
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  targets.forEach((t) => spy.observe(t));
  requestAnimationFrame(() => movePill(active));
}

/* ---------- magnetic buttons: they lean toward the cursor ---------- */
function initMagnetic() {
  if (reduce || !finePointer) return;
  document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      el.style.setProperty('--mx', `${(x * 0.22).toFixed(1)}px`);
      el.style.setProperty('--my', `${(y * 0.3).toFixed(1)}px`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--mx', '0px');
      el.style.setProperty('--my', '0px');
    });
  });
}

/* ---------- cursor spotlight on cards ---------- */
function initSpotlight() {
  if (!finePointer) return;
  document.querySelectorAll<HTMLElement>('[data-spotlight]').forEach((group) => {
    group.addEventListener(
      'pointermove',
      (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('[data-spot]');
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--sx', `${e.clientX - r.left}px`);
        card.style.setProperty('--sy', `${e.clientY - r.top}px`);
      },
      { passive: true },
    );
  });
}

initReveal();
initCounters();
initNav();
initMagnetic();
initSpotlight();
