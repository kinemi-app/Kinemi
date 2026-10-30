// Telling you a render landed, the ways Settings → Notifications allows: a toast in the studio,
// a short chime, and a browser notification while Kinemi is in the background.
import { BASE } from './deploy';
import { settings } from './prefs';
import { toast, type Toast } from './ui/toast';

let audio: AudioContext | null = null;

/** Browsers only let a page make sound after a click: call this from one so the chime can play later. */
export function primeSound() {
  try {
    const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    /* no audio here */
  }
}

/** Two short square-wave blips, pixel style. */
export function chime() {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  [784, 1175].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    const at = t + i * 0.1;
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    osc.connect(gain).connect(audio!.destination);
    osc.start(at);
    osc.stop(at + 0.1);
  });
}

export const canNotify = () => typeof Notification !== 'undefined';

/** Ask the browser for permission. Resolves to what it said. */
export async function askToNotify(): Promise<NotificationPermission | 'unsupported'> {
  if (!canNotify()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function desktop(title: string, body?: string) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: `${BASE}favicon.svg`, tag: 'kinemi-render' });
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

/** A render (or a batch) landed. */
export function announce(t: Omit<Toast, 'id'>) {
  const s = settings.value;
  if (s.notifyToast) toast(t);
  if (s.notifySound) chime();
  if (s.notifyDesktop && document.hidden) desktop(t.title, t.body);
}
