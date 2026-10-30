import { signal } from '@preact/signals';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  /** an asset to open from the toast */
  asset?: string;
  action?: { label: string; run: () => void };
  /** fading out: it leaves the list once the animation is over */
  leaving?: boolean;
}

/** How long a toast takes to fade out; matches `toast-out` in studio.css. */
export const LEAVE_MS = 260;

export const toasts = signal<Toast[]>([]);
let n = 0;

export function toast(t: Omit<Toast, 'id' | 'leaving'>, ms = 4600) {
  const id = ++n;
  const shown = toasts.value.filter((x) => !x.leaving);
  // three at a time: the oldest one fades out to make room
  if (shown.length >= 3) dismiss(shown[0].id);
  toasts.value = [...toasts.value, { ...t, id }];
  setTimeout(() => dismiss(id), ms);
  return id;
}

/** Fade a toast out, then remove it. */
export function dismiss(id: number) {
  const t = toasts.value.find((x) => x.id === id);
  if (!t || t.leaving) return;
  toasts.value = toasts.value.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), LEAVE_MS);
}
