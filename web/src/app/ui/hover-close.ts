// Dropdowns opened with a mouse close once the pointer has left them for a moment.
// Touch has no hover and keyboard use never moves the pointer, so neither closes anything here.

/** How long the pointer may be outside before the dropdown closes: enough to cross a small gap. */
export const LEAVE_MS = 250;

// where the mouse last was: `:hover` lags behind DOM changes, so a menu that opens right after
// another closed may not see its own button as hovered yet
let last: { x: number; y: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointermove',
    (e) => {
      last = e.pointerType === 'touch' ? null : { x: e.clientX, y: e.clientY };
    },
    { capture: true, passive: true },
  );
}

/** The mouse rests on this element (by its last position, not by `:hover`). */
export function pointerOn(el: Element | null | undefined) {
  if (!el || !last) return false;
  const r = el.getBoundingClientRect();
  return last.x >= r.left && last.x <= r.right && last.y >= r.top && last.y <= r.bottom;
}

/**
 * Call `close` when a mouse or pen pointer has stayed outside `inside` for `ms`. It only counts
 * once the pointer has been inside (or `armed` says it already is), so a dropdown opened from the
 * keyboard stays open. Returns the cleanup.
 */
export function closeOnLeave(inside: (el: Element) => boolean, close: () => void, { armed = false, ms = LEAVE_MS } = {}) {
  let isArmed = armed;
  let timer = 0;
  const later = () => {
    if (isArmed && !timer) timer = window.setTimeout(close, ms);
  };
  const onOver = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (e.target instanceof Element && inside(e.target)) {
      isArmed = true;
      clearTimeout(timer);
      timer = 0;
    } else later();
  };
  // leaving the window fires no pointerover anywhere
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') later();
  };
  const root = document.documentElement;
  document.addEventListener('pointerover', onOver, true);
  root.addEventListener('pointerleave', onLeave);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('pointerover', onOver, true);
    root.removeEventListener('pointerleave', onLeave);
  };
}
