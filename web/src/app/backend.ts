// The Kinemi server's API, the only module in the studio that calls it. The server (Next, the repo
// root) decides where renders run: its own demo generator, or the ComfyUI its .env names.
import { BASE } from './deploy';
import type { Mode, Registry } from './data/backend-map';
import type { Asset, Chat, Folder, Tag } from './store';

export interface ServerStatus {
  /** demo: renders come from the built-in demo generator; cloud: from the configured ComfyUI */
  generation: 'demo' | 'cloud';
  mode: string;
  comfy: { configured: boolean; origin: string; hasKey: boolean };
  models: number;
}

/** What a ComfyUI run is really doing, as the server last read it. All times are epoch ms. */
export interface JobLive {
  phase: 'queued' | 'running' | 'done';
  /** why it waits, while queued: "Waiting for a machine…" */
  message?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  step?: number;
  steps?: number;
  node?: string;
  /** 0..1 */
  fraction: number;
  /** absent when the server can't tell: the studio never guesses one */
  remainingMs?: number;
  gpuMs: number;
  /** Comfy Cloud credits; a local ComfyUI reports none */
  credits?: number;
  source: 'cloud' | 'local';
}

export interface ServerJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  demo: boolean;
  /** absent from the demo backend */
  live?: JobLive;
  result?: { url: string; kind: 'image' | 'video' | 'audio'; width: number; height: number };
  error?: string;
}

export interface GenerateBody {
  mode: Mode;
  modelId: string;
  prompt: string;
  durationS: number;
  seed?: number;
  params?: Record<string, string | number | boolean>;
}

/** A refusal or failure from the server, with the reason it gave. status 0: it never answered. */
export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const API = `${BASE}api`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, init);
  } catch {
    throw new BackendError(0, 'The Kinemi server isn’t reachable.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = typeof body?.error === 'string' ? body.error : `The server answered ${response.status}.`;
    throw new BackendError(response.status, reason);
  }
  return body as T;
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getStatus = () => call<ServerStatus>('/status');

/* Chats: kept in the server's SQLite file. keepalive lets a save finish while the tab closes. */
export const listChats = () => call<{ chats: Chat[] }>('/chats').then((r) => r.chats);
export const saveChat = (chat: Chat, keepalive = false) =>
  call<{ ok: true }>(`/chats/${encodeURIComponent(chat.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chat), keepalive });
export const removeChat = (id: string, keepalive = false) => call<unknown>(`/chats/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive });

/* The asset library (assets, folders, tags): kept in the server's SQLite file, one JSON object each. */
export type LibraryKind = 'asset' | 'folder' | 'tag';
export interface Library {
  assets: Asset[];
  folders: Folder[];
  tags: Tag[];
}
export const getLibrary = () => call<Library>('/library');
export const saveLibraryItem = (kind: LibraryKind, item: { id: string }, keepalive = false) =>
  call<{ ok: true }>(`/library/${kind}/${encodeURIComponent(item.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item), keepalive });
export const removeLibraryItem = (kind: LibraryKind, id: string, keepalive = false) =>
  call<unknown>(`/library/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive });

/* Imported files: the raw bytes under the asset's id, readable from any browser. */
const filePath = (id: string) => `/files/${encodeURIComponent(id)}`;
export const putServerFile = (id: string, blob: Blob) => call<{ ok: true }>(filePath(id), { method: 'PUT', body: blob });
export const removeServerFile = (id: string, keepalive = false) => call<unknown>(filePath(id), { method: 'DELETE', keepalive });
/** The stored file, or null when the server has none under that id. */
export async function getServerFile(id: string): Promise<Blob | null> {
  let response: Response;
  try {
    response = await fetch(`${API}${filePath(id)}`);
  } catch {
    throw new BackendError(0, 'The Kinemi server isn’t reachable.');
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new BackendError(response.status, `The server answered ${response.status}.`);
  return response.blob();
}

let registry: Promise<Registry> | null = null;
/** The model registry, asked once per page; a failed ask is retried next time. */
export function getRegistry() {
  registry ??= call<Registry>('/models').catch((e) => {
    registry = null;
    throw e;
  });
  return registry;
}

/** Start a render; resolves to the server's job id. */
export const generate = (body: GenerateBody) => call<{ jobId: string }>('/generate', postJson(body)).then((r) => r.jobId);

export const getJob = (id: string) => call<ServerJob>(`/jobs/${encodeURIComponent(id)}`);

/** One node of a ComfyUI graph in API format: what /prompt takes. */
export interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

/** The ComfyUI graph the server would send for this request, without running it. */
export const getGraph = (body: GenerateBody) =>
  call<{ graph: { nodes: Record<string, ApiNode>; output: 'image' | 'video' | 'audio' } }>('/generate/graph', postJson(body)).then((r) => r.graph);

/** Upload a source file; resolves to the name a request passes as imageName, videoName or audioName. */
export async function upload(file: Blob, name: string) {
  const form = new FormData();
  form.append('file', file, name);
  return (await call<{ name: string }>('/assets', { method: 'POST', body: form })).name;
}
