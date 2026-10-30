// Small helpers shared across the dashboard.

export const cx = (...c: Array<string | false | null | undefined | 0>) => c.filter(Boolean).join(' ');

let counter = 0;
/** Short unique id. Deterministic order on the server, random on the client. */
export function id(prefix = 'id') {
  counter += 1;
  const r = typeof window === 'undefined' ? counter.toString(36) : Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r}${counter.toString(36)}`;
}

/** 32-bit string hash (FNV-1a). */
export function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded random numbers (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const pick = <T,>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** “just now”, “12 min ago”, “3 h ago”, “Yesterday”, “4 days ago”, “12 Oct”. */
export function ago(t: number, now = Date.now()) {
  const d = now - t;
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY && new Date(t).getDate() === new Date(now).getDate()) return `${Math.floor(d / HOUR)} h ago`;
  if (isYesterday(t, now)) return 'Yesterday';
  if (d < 7 * DAY) return `${Math.ceil(d / DAY)} days ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function isToday(t: number, now = Date.now()) {
  const a = new Date(t);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isYesterday(t: number, now = Date.now()) {
  return isToday(t + DAY, now);
}

export function dayGroup(t: number, now = Date.now()) {
  if (isToday(t, now)) return 'Today';
  if (isYesterday(t, now)) return 'Yesterday';
  if (now - t < 7 * DAY) return 'This week';
  return 'Earlier';
}

export function fullDate(t: number) {
  return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 00:00:04:12 style timecode at 24 fps. */
export function timecode(seconds: number, fps = 24) {
  const f = Math.floor((seconds % 1) * fps);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return [h, m, s, f].map((n) => String(n).padStart(2, '0')).join(':');
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const isBrowser = typeof window !== 'undefined';

/** Less motion: the device asks for it, or Settings → Interface → Motion is on Reduce. */
export const reducedMotion = () => isBrowser && (document.documentElement.classList.contains('motion-reduce') || matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Run a DOM update inside a view transition when the browser has them. */
export function transition(update: () => void) {
  const doc = isBrowser ? (document as Document & { startViewTransition?: (cb: () => Promise<void> | void) => unknown }) : null;
  if (!doc?.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(async () => {
    update();
    // Preact renders on a microtask: wait for it so the new state is captured
    await new Promise((r) => setTimeout(r, 0));
  });
}

export function copyText(text: string) {
  try {
    return navigator.clipboard.writeText(text);
  } catch {
    return Promise.reject();
  }
}
