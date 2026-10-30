// The keys you bring and the places Kinemi talks to: Comfy Cloud and ComfyUI on your own GPU for renders,
// OpenRouter for the chat. Keys stay in this browser: apart from the studio, so no export or account sync
// ever carries them, and they only ever go to the service they belong to.
import { signal } from '@preact/signals';
import { getStatus, type ServerStatus } from './backend';
import { BASE, COMFY_CLOUD } from './deploy';
import { cleanKey } from './keys';
import { onThisComputer } from './local';
import type { ModelFile } from './data/model-files';
import { patchSettings, SECRETS_KEY, settings } from './store';

export interface Secrets {
  comfyKey?: string;
  openrouterKey?: string;
}

export const secrets = signal<Secrets>({});
/** Keep the keys after the tab closes. Off: they live in this tab's session only. */
export const rememberKeys = signal(true);

/** Keys saved before cleanKey existed may still carry a pasted quote: they load without it. */
const cleaned = ({ comfyKey, openrouterKey }: Secrets): Secrets => ({
  ...(comfyKey ? { comfyKey: cleanKey(comfyKey) } : {}),
  ...(openrouterKey ? { openrouterKey: cleanKey(openrouterKey) } : {}),
});

export function loadSecrets() {
  try {
    const kept = localStorage.getItem(SECRETS_KEY);
    const session = kept ? null : sessionStorage.getItem(SECRETS_KEY);
    secrets.value = cleaned(JSON.parse(kept ?? session ?? '{}') ?? {});
    rememberKeys.value = !session;
  } catch {
    secrets.value = {};
  }
}

function store(next: Secrets, remember = rememberKeys.value) {
  secrets.value = next;
  rememberKeys.value = remember;
  try {
    localStorage.removeItem(SECRETS_KEY);
    sessionStorage.removeItem(SECRETS_KEY);
    if (next.comfyKey || next.openrouterKey) (remember ? localStorage : sessionStorage).setItem(SECRETS_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the keys last until the tab closes */
  }
}

export const setRemember = (on: boolean) => store(secrets.value, on);

const hint = (k: string) => k.slice(-4);

/** A key for display: its prefix (“sk-or-”, “comfyui-”), dots, the last four characters. */
export function masked(k: string) {
  const head = (k.match(/^[a-z]+[-_](?:[a-z0-9]{1,4}[-_])?/i)?.[0] ?? '').slice(0, 10);
  return `${head}••••••••${hint(k)}`;
}

/* ------------------------------------------------------------------ */
/* Where renders run                                                   */
/* ------------------------------------------------------------------ */

/** Renders have somewhere to go: a Comfy Cloud key, or a ComfyUI address. */
export function connected() {
  const s = settings.value;
  return (s.compute === 'key' && !!secrets.value.comfyKey) || (s.compute === 'local' && !!s.endpoint);
}

/** Where the Kinemi server renders (GET /api/status); null until it answers. */
export const serverStatus = signal<ServerStatus | null>(null);
let asked = false;

/** The render target to show: the server's ComfyUI or its demo generator. Asks the server once per page. */
export function renderTarget() {
  if (!asked && typeof window !== 'undefined') {
    asked = true;
    getStatus().then((s) => (serverStatus.value = s), () => undefined);
  }
  const s = serverStatus.value;
  if (s?.generation === 'cloud') return { name: 'ComfyUI', detail: s.comfy.origin.replace(/^https?:\/\//, ''), icon: 'gpu', demo: false } as const;
  return { name: 'Kinemi server', detail: s ? 'Built-in generator' : 'Asking the server…', icon: 'plug', demo: true } as const;
}

export function saveComfyKey(key: string, remember?: boolean) {
  const k = cleanKey(key);
  store({ ...secrets.value, comfyKey: k }, remember);
  patchSettings({ compute: 'key', keyHint: hint(k) });
}

export function forgetComfyKey() {
  const { comfyKey: _, ...rest } = secrets.value;
  store(rest);
  const s = settings.value;
  patchSettings({ keyHint: undefined, ...(s.compute === 'key' ? { compute: s.endpoint ? 'local' : 'none' } : {}) });
}

/** A ComfyUI address as an origin, or null when it isn't one. */
export function origin(address: string) {
  const raw = address.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return u.origin;
  } catch {
    return null;
  }
}

export function saveEndpoint(address: string) {
  const o = origin(address);
  if (!o) return false;
  patchSettings({ compute: 'local', endpoint: o });
  return true;
}

export function forgetEndpoint() {
  const s = settings.value;
  patchSettings({ endpoint: undefined, ...(s.compute === 'local' ? { compute: secrets.value.comfyKey ? 'key' : 'none' } : {}) });
}

/** Switch between the two once both are set up. */
export function renderOn(where: 'key' | 'local') {
  if (where === 'key' && secrets.value.comfyKey) patchSettings({ compute: 'key' });
  if (where === 'local' && settings.value.endpoint) patchSettings({ compute: 'local' });
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export type Check = { ok: true; title: string; lines: string[] } | { ok: false; title: string; body: string; fix?: string };

const timeout = (ms: number) => (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined);

const gb = (bytes: unknown) => (typeof bytes === 'number' && bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(bytes > 10 * 1024 ** 3 ? 0 : 1)} GB` : '');

/** “cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync” → “NVIDIA GeForce RTX 4090” */
const deviceName = (name: unknown) =>
  String(name ?? '')
    .replace(/^\w+:\d+\s*/, '')
    .replace(/\s*:\s*\w+$/, '')
    .trim();

/** The command that starts ComfyUI so this site may talk to it. */
export const corsCommand = () => `python main.py --enable-cors-header ${typeof location === 'undefined' ? '*' : location.origin}`;

/** Ask ComfyUI on your own GPU who it is: GET /system_stats. */
export async function testLocal(address: string): Promise<Check> {
  const base = origin(address);
  if (!base) return { ok: false, title: 'That isn’t an address', body: 'Use a full address, like http://127.0.0.1:8188' };
  const host = base.replace(/^https?:\/\//, '');
  try {
    const r = await fetch(`${base}/system_stats`, { signal: timeout(5000) });
    if (!r.ok) return { ok: false, title: `${host} answered ${r.status}`, body: 'Something is running there, but it isn’t ComfyUI’s API. Check the port.' };
    const s = await r.json();
    const sys = s?.system ?? {};
    const dev = Array.isArray(s?.devices) ? s.devices[0] : undefined;
    const lines = [
      [sys.comfyui_version && `ComfyUI ${sys.comfyui_version}`, sys.python_version && `Python ${String(sys.python_version).split(' ')[0]}`, sys.pytorch_version && `PyTorch ${String(sys.pytorch_version).split('+')[0]}`]
        .filter(Boolean)
        .join(' · '),
      dev ? [deviceName(dev.name) || dev.type, gb(dev.vram_total) && `${gb(dev.vram_total)} VRAM`, gb(dev.vram_free) && `${gb(dev.vram_free)} free`].filter(Boolean).join(' · ') : 'No GPU reported: ComfyUI runs on the CPU',
    ].filter(Boolean);
    return { ok: true, title: `ComfyUI answers at ${host}`, lines };
  } catch {
    return {
      ok: false,
      title: `No answer from ${host}`,
      body: 'Is ComfyUI running? It also has to let this site talk to it: add this flag to however you start it. If your browser asks whether this site may reach devices on your network, allow it.',
      fix: corsCommand(),
    };
  }
}

/** Ask Comfy Cloud through the Kinemi server on this computer: Comfy Cloud doesn't take calls from web pages. */
async function viaLocalServer(key: string) {
  if (!onThisComputer()) return null;
  try {
    const r = await fetch(`${BASE}api/local/comfycloud`, { headers: { 'X-API-Key': key }, signal: timeout(12000) });
    return r.headers.get('X-Kinemi-Proxy') ? r : null;
  } catch {
    return null;
  }
}

/** Check a Comfy Cloud key: GET /api/user with the X-API-Key header. */
export async function testCloud(key: string): Promise<Check> {
  try {
    const r = (await viaLocalServer(cleanKey(key))) ?? (await fetch(`${COMFY_CLOUD}/api/user`, { headers: { 'X-API-Key': cleanKey(key) }, signal: timeout(8000) }));
    if (r.status === 502) return { ok: false, title: 'Couldn’t reach Comfy Cloud', body: 'You may be offline. The key is saved either way.' };
    if (r.status === 401 || r.status === 403) return { ok: false, title: 'Comfy Cloud refused this key', body: 'Check that you pasted all of it, or make a new key at platform.comfy.org under API Keys.' };
    if (r.status === 429) return { ok: false, title: 'No API access on this plan', body: 'The key is real, but its plan has no API access or isn’t active. API access needs a paid Comfy Cloud plan.' };
    if (!r.ok) return { ok: false, title: `Comfy Cloud answered ${r.status}`, body: 'Try again in a minute.' };
    const u = await r.json().catch(() => ({}));
    const who = u?.email || u?.username || u?.name;
    return { ok: true, title: 'The key works', lines: [who ? `Comfy Cloud account: ${who}` : 'Comfy Cloud accepted it'] };
  } catch {
    return {
      ok: false,
      title: 'Couldn’t check it from this browser',
      body: 'Comfy Cloud doesn’t take calls from web pages, so only a server can check the key: on your own computer, start Kinemi with npm start. The key is saved either way.',
    };
  }
}

export type FileState = { state: 'found'; as?: string } | { state: 'missing' } | { state: 'no-node' };

/** Ask ComfyUI which model files each loader node can see: GET /object_info/<node>. */
export async function checkFiles(address: string, files: ModelFile[], name: (f: ModelFile) => string): Promise<Record<string, FileState> | Check> {
  const base = origin(address);
  if (!base) return { ok: false, title: 'Set your ComfyUI address first', body: 'Settings → Providers → Your own GPU.' };
  const nodes = [...new Set(files.map((f) => f.node))];
  const options = new Map<string, string[] | null>();
  try {
    await Promise.all(
      nodes.map(async (node) => {
        const r = await fetch(`${base}/object_info/${encodeURIComponent(node)}`, { signal: timeout(8000) });
        const info = r.ok ? ((await r.json())?.[node] ?? null) : null;
        options.set(node, info ? [] : null);
        if (!info) return;
        for (const f of files.filter((x) => x.node === node)) {
          const spec = info.input?.required?.[f.input] ?? info.input?.optional?.[f.input];
          // a combo is either [[...names], {...}] or, in newer ComfyUI, ['COMBO', { options: [...] }]
          const list: unknown = Array.isArray(spec?.[0]) ? spec[0] : spec?.[0] === 'COMBO' ? spec?.[1]?.options : [];
          options.set(`${node}:${f.input}`, Array.isArray(list) ? list.map(String) : []);
        }
      }),
    );
  } catch {
    return { ok: false, title: 'No answer from ComfyUI', body: 'Test the connection first, then check the files.', fix: corsCommand() };
  }
  const out: Record<string, FileState> = {};
  for (const f of files) {
    if (options.get(f.node) === null) {
      out[f.id] = { state: 'no-node' };
      continue;
    }
    const want = name(f);
    const list = options.get(`${f.node}:${f.input}`) ?? [];
    const hit = list.find((o) => o === want) ?? list.find((o) => o.replace(/\\/g, '/').split('/').pop() === want.split('/').pop());
    out[f.id] = hit ? { state: 'found', as: hit === want ? undefined : hit } : { state: 'missing' };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* OpenRouter                                                          */
/* ------------------------------------------------------------------ */

export const OPENROUTER = 'https://openrouter.ai/api/v1';

export interface RouterModel {
  id: string;
  name: string;
  context: number;
  /** USD per million tokens, in and out */
  price: [number, number];
}

export const routerModels = signal<RouterModel[]>([]);

export function saveRouterKey(key: string, remember?: boolean) {
  store({ ...secrets.value, openrouterKey: cleanKey(key) }, remember);
}

export function forgetRouterKey() {
  const { openrouterKey: _, ...rest } = secrets.value;
  store(rest);
  if (settings.value.assistant === 'openrouter') patchSettings({ assistant: 'builtin' });
}

/** Check an OpenRouter key and load the models it can use: GET /models. */
export async function testRouter(key: string): Promise<Check> {
  try {
    const r = await fetch(`${OPENROUTER}/models?output_modalities=text`, { headers: { Authorization: `Bearer ${key.trim()}` }, signal: timeout(10000) });
    if (r.status === 401 || r.status === 403) return { ok: false, title: 'OpenRouter refused this key', body: 'Check that you pasted all of it, or make a new one at openrouter.ai/keys.' };
    if (!r.ok) return { ok: false, title: `OpenRouter answered ${r.status}`, body: 'Try again in a minute.' };
    const data = (await r.json())?.data;
    const list: RouterModel[] = (Array.isArray(data) ? data : [])
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => ({
        id: m.id,
        name: String(m.name || m.id),
        context: Number(m.context_length) || 0,
        price: [Number(m.pricing?.prompt) * 1e6 || 0, Number(m.pricing?.completion) * 1e6 || 0] as [number, number],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    routerModels.value = list;
    return { ok: true, title: 'The key works', lines: [`${list.length} models to choose from`] };
  } catch {
    return { ok: false, title: 'Couldn’t reach OpenRouter', body: 'You may be offline. The key is saved either way.' };
  }
}
