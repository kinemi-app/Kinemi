// Dashboard state: one signal per collection, saved to localStorage after the first load.
// The server renders the seed state; the browser swaps in what it saved once the app has hydrated.
import { batch, computed, effect, signal } from '@preact/signals';
import type { AssetKind, ToolId } from './data/tools';
import type { Estimate } from './data/models';
import type { ServerHints } from './data/backend-request';
import type { JobLive } from './backend';
import { id as newId, isBrowser } from './lib/util';
import { removeFile } from './lib/files';
import { DEFAULT_SETTINGS, DEVICE_SETTINGS, settings, type Settings } from './prefs';
import { SEED } from './seed';

export { DEFAULT_SETTINGS, DEVICE_SETTINGS, NEG_IMAGE, NEG_VIDEO, patchSettings, settings, type Assistant, type Settings } from './prefs';

export type Pair = [string, string];

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  tool: ToolId;
  model?: string;
  folderId: string | null;
  tagIds: string[];
  favorite: boolean;
  trashedAt?: number;
  createdAt: number;
  aspect: string;
  /** seconds, for video and audio */
  duration?: number;
  prompt?: string;
  params?: Pair[];
  runtime?: number;
  credits?: number;
  /** poster generator inputs */
  scene: string;
  seed: number;
  palette?: string[];
  panels?: number;
  source: 'chat' | 'tool' | 'import' | 'seed';
  chatId?: string;
  /** a Supercomputer run: the batch and the plan cell it came from */
  batch?: string;
  cell?: string;
  /** imported file: the bytes live in IndexedDB under the asset id */
  file?: { type: string; size: number };
  /** a server render: where its file is (GET /api/jobs result.url) */
  url?: string;
  /** what that file is (GET /api/jobs result.kind); a ComfyUI /view URL has no extension to tell */
  media?: 'image' | 'video' | 'audio';
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface RenderSpec {
  tool: ToolId;
  kind: AssetKind;
  name: string;
  model?: string;
  aspect: string;
  duration?: number;
  prompt: string;
  params: Pair[];
  estimate: Estimate;
  scene: string;
  seed: number;
  palette?: string[];
  panels?: number;
  /** how many assets one render makes */
  count?: number;
  folderId?: string | null;
  tagIds?: string[];
  chatId?: string;
  msgId?: string;
  /** cells of a Supercomputer plan share a batch and run four at a time */
  batch?: string;
  cell?: string;
  /** what the server needs beyond the prompt: source asset, pinned model, params (data/backend-request.ts) */
  server?: ServerHints;
}

export interface ToolCall {
  tool: ToolId;
  /** the tool settings it was built from, so a follow-up can change one of them */
  values: Record<string, unknown>;
  title: string;
  params: Pair[];
  prompt: string;
  estimate: Estimate;
  spec: RenderSpec;
  status: 'ready' | 'queued' | 'rendering' | 'done' | 'cancelled';
  /** set up by the assistant and waiting for the owner's Approve click; nothing runs while it is on */
  proposed?: boolean;
  jobId?: string;
  assetIds?: string[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  call?: ToolCall;
  /** follow-up suggestions shown under the reply */
  chips?: string[];
  /** who answered, when it wasn't the built-in assistant: “Claude Code · sonnet” */
  by?: string;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface Character {
  id: string;
  name: string;
  tag: string;
  look: string;
  locked: boolean;
  seed: number;
  createdAt: number;
}

export interface Job {
  id: string;
  spec: RenderSpec;
  status: 'queued' | 'rendering' | 'done' | 'cancelled' | 'failed';
  progress: number;
  /** the server's live report, its takes merged into one; absent from the demo backend */
  live?: JobLive;
  startedAt?: number;
  doneAt?: number;
  assetIds?: string[];
  /** the server's job ids, one per asset the spec asks for */
  serverIds?: string[];
  /** why the server refused or failed the render */
  error?: string;
}

export type Scope = { type: 'all' | 'favorites' | 'recent' | 'unsorted' | 'trash' } | { type: 'folder'; id: string };

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export const assets = signal<Asset[]>(SEED.assets);
export const folders = signal<Folder[]>(SEED.folders);
export const tags = signal<Tag[]>(SEED.tags);
export const chats = signal<Chat[]>(SEED.chats);
export const cast = signal<Character[]>(SEED.cast);
/** per-tool form values, so a half-built shot survives a reload */
export const drafts = signal<Record<string, Record<string, unknown>>>({});

export const jobs = signal<Job[]>([]);
export const activeChatId = signal<string | null>(null);
/** The local server's database holds the chats, so the browser's copy of the studio leaves them out. */
export const chatsOnServer = signal(false);
/** Likewise for the library: assets, folders and tags live in the server's database. */
export const assetsOnServer = signal(false);
/** true once saved state is loaded in the browser */
export const ready = signal(false);

/* asset store view */
export const scope = signal<Scope>({ type: 'all' });
export const query = signal('');
export const kindFilter = signal<AssetKind[]>([]);
export const toolFilter = signal<ToolId[]>([]);
export const tagFilter = signal<string[]>([]);
export const selection = signal<string[]>([]);
export const openAssetId = signal<string | null>(null);

export const liveAssets = computed(() => assets.value.filter((a) => !a.trashedAt));
export const trashed = computed(() => assets.value.filter((a) => a.trashedAt));
export const activeJobs = computed(() => jobs.value.filter((j) => j.status === 'queued' || j.status === 'rendering'));

export const TAG_COLORS = ['#39d879', '#2ee6c4', '#5aa9e6', '#8b7bff', '#ff9f5a', '#ff6b7a', '#f2d45c', '#a7b4c0'];

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

/** This browser's own studio: the guest's, and the only one without accounts.
 *  A signed-in account's studio is cached next to it, under `${STUDIO_SLOT}:<user id>`. */
export const STUDIO_SLOT = 'kinemi.studio.v1';
/** Settings that stay with this browser, whoever is signed in. */
export const DEVICE_KEY = 'kinemi.device.v1';
/** Keys you bring (Comfy Cloud, OpenRouter): kept apart, so no export or sync ever carries them. */
export const SECRETS_KEY = 'kinemi.secrets.v1';

/** Everything that makes up a studio, as it is saved, exported and synced. */
export interface StudioData {
  assets: Asset[];
  folders: Folder[];
  tags: Tag[];
  chats: Chat[];
  cast: Character[];
  settings: Partial<Settings>;
  drafts: Record<string, Record<string, unknown>>;
}

let current = STUDIO_SLOT;
let pending: { studio: string; device: string } | null = null;
let timer = 0;
let stopWatch: (() => void) | null = null;
let hooked = false;

function read(key: string) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    /* private mode or a broken entry */
    return null;
  }
}

export const deviceSettings = (s: Partial<Settings>) => Object.fromEntries(DEVICE_SETTINGS.filter((k) => k in s).map((k) => [k, s[k]])) as Partial<Settings>;

export function studioSettings(s: Partial<Settings>) {
  const out = { ...s };
  for (const k of DEVICE_SETTINGS) delete out[k];
  return out;
}

/** The studio on screen, without this browser's own settings. */
export const snapshot = (): StudioData => ({
  assets: assets.value,
  folders: folders.value,
  tags: tags.value,
  chats: chats.value,
  cast: cast.value,
  settings: studioSettings(settings.value),
  drafts: drafts.value,
});

/** Put a studio on screen: what was saved over the sample studio, with this browser's settings on top. */
export function applyStudio(s: Partial<StudioData> | null, device: Partial<Settings> | null) {
  batch(() => {
    assets.value = Array.isArray(s?.assets) ? s.assets : SEED.assets;
    folders.value = Array.isArray(s?.folders) ? s.folders : SEED.folders;
    tags.value = Array.isArray(s?.tags) ? s.tags : SEED.tags;
    chats.value = Array.isArray(s?.chats) ? s.chats.map(settle) : SEED.chats;
    cast.value = Array.isArray(s?.cast) ? s.cast : SEED.cast;
    const next: Settings = { ...DEFAULT_SETTINGS, ...studioSettings(s?.settings ?? {}), ...deviceSettings(device ?? s?.settings ?? {}) };
    // older saves knew a try-out mode; it is gone, so they start unconnected
    if (!['none', 'key', 'local'].includes(next.compute)) next.compute = 'none';
    settings.value = next;
    drafts.value = s?.drafts && typeof s.drafts === 'object' ? s.drafts : {};
    activeChatId.value = null;
    selection.value = [];
    openAssetId.value = null;
  });
}

/** Write anything waiting to localStorage now. */
export function flushState() {
  clearTimeout(timer);
  if (!pending) return;
  try {
    localStorage.setItem(current, pending.studio);
    localStorage.setItem(DEVICE_KEY, pending.device);
  } catch {
    /* storage full or blocked */
  }
  pending = null;
}

function watch() {
  stopWatch?.();
  stopWatch = effect(() => {
    const s = settings.value;
    pending = {
      studio: JSON.stringify({
        v: 1,
        ...snapshot(),
        ...(chatsOnServer.value ? { chats: [] } : {}),
        ...(assetsOnServer.value ? { assets: [], folders: [], tags: [] } : {}),
        settings: studioSettings(s),
      }),
      device: JSON.stringify(deviceSettings(s)),
    };
    clearTimeout(timer);
    timer = window.setTimeout(flushState, 250);
  });
  if (hooked) return;
  hooked = true;
  // a change made just before the tab closes still gets written
  addEventListener('pagehide', flushState);
  document.addEventListener('visibilitychange', () => document.hidden && flushState());
}

export function loadState() {
  if (!isBrowser || ready.value) return;
  current = STUDIO_SLOT;
  applyStudio(read(STUDIO_SLOT), read(DEVICE_KEY));
  ready.value = true;
  watch();
}

/** Show another studio: an account's (from its cache, or the data given), or this browser's own again. */
export function switchStudio(key: string, data?: Partial<StudioData> | null) {
  flushState();
  current = key;
  applyStudio(data ?? read(key), read(DEVICE_KEY));
  watch();
}

/** The localStorage key of the studio on screen. */
export const studioKey = () => current;

/** Renders don't survive a reload: a call that was mid-render is ready to go again. */
export function settle(c: Chat): Chat {
  return {
    ...c,
    messages: c.messages.map((m) =>
      m.call && (m.call.status === 'queued' || m.call.status === 'rendering') ? { ...m, call: { ...m.call, status: 'ready', jobId: undefined } } : m,
    ),
  };
}

/** Start over in this browser: the sample studio, default settings and no saved keys. */
export function resetStudio() {
  stopWatch?.();
  pending = null;
  try {
    localStorage.removeItem(current);
    localStorage.removeItem(DEVICE_KEY);
    localStorage.removeItem(SECRETS_KEY);
    sessionStorage.removeItem(SECRETS_KEY);
  } catch {
    /* ignore */
  }
  location.reload();
}


/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

const mapAssets = (ids: string[], fn: (a: Asset) => Asset) => {
  const set = new Set(ids);
  assets.value = assets.value.map((a) => (set.has(a.id) ? fn(a) : a));
};

export const assetById = (id: string) => assets.value.find((a) => a.id === id);

export function addAssets(list: Asset[]) {
  assets.value = [...list, ...assets.value];
}

export const moveAssets = (ids: string[], folderId: string | null) => mapAssets(ids, (a) => ({ ...a, folderId, trashedAt: undefined }));

/** Tag a set of assets. If every one already has the tag, take it off instead. */
export function toggleTag(ids: string[], tagId: string, force?: boolean) {
  const list = assets.value.filter((a) => ids.includes(a.id));
  const on = force ?? !list.every((a) => a.tagIds.includes(tagId));
  mapAssets(ids, (a) => ({
    ...a,
    tagIds: on ? (a.tagIds.includes(tagId) ? a.tagIds : [...a.tagIds, tagId]) : a.tagIds.filter((t) => t !== tagId),
  }));
  return on;
}

export function toggleFavorite(ids: string[]) {
  const list = assets.value.filter((a) => ids.includes(a.id));
  const on = !list.every((a) => a.favorite);
  mapAssets(ids, (a) => ({ ...a, favorite: on }));
  return on;
}

export const renameAsset = (id: string, name: string) => mapAssets([id], (a) => ({ ...a, name: name.trim() || a.name }));

export function trashAssets(ids: string[]) {
  const now = Date.now();
  mapAssets(ids, (a) => ({ ...a, trashedAt: now }));
  selection.value = selection.value.filter((s) => !ids.includes(s));
  if (openAssetId.value && ids.includes(openAssetId.value)) openAssetId.value = null;
}

export const restoreAssets = (ids: string[]) => mapAssets(ids, (a) => ({ ...a, trashedAt: undefined }));

export function deleteForever(ids: string[]) {
  const set = new Set(ids);
  assets.value = assets.value.filter((a) => !set.has(a.id));
  selection.value = selection.value.filter((s) => !set.has(s));
  ids.forEach((i) => removeFile(i).catch(() => {}));
}

export function duplicateAsset(id: string) {
  const a = assetById(id);
  if (!a || a.file) return;
  const copy: Asset = { ...a, id: newId('a'), name: `${a.name} copy`, createdAt: Date.now(), favorite: false };
  assets.value = [copy, ...assets.value];
  return copy;
}

/* ------------------------------------------------------------------ */
/* Folders and tags                                                    */
/* ------------------------------------------------------------------ */

export function createFolder(name: string) {
  const f: Folder = { id: newId('f'), name: name.trim() || 'New folder', createdAt: Date.now() };
  folders.value = [...folders.value, f];
  return f;
}

export const renameFolder = (id: string, name: string) =>
  (folders.value = folders.value.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)));

/** Delete a folder; its assets go back to Unsorted. */
export function deleteFolder(id: string) {
  batch(() => {
    folders.value = folders.value.filter((f) => f.id !== id);
    assets.value = assets.value.map((a) => (a.folderId === id ? { ...a, folderId: null } : a));
    if (scope.value.type === 'folder' && scope.value.id === id) scope.value = { type: 'all' };
  });
}

export function createTag(name: string, color?: string) {
  const t: Tag = {
    id: newId('t'),
    name: name.trim().toLowerCase() || 'tag',
    color: color ?? TAG_COLORS[tags.value.length % TAG_COLORS.length],
  };
  tags.value = [...tags.value, t];
  return t;
}

export const updateTag = (id: string, p: Partial<Tag>) => (tags.value = tags.value.map((t) => (t.id === id ? { ...t, ...p } : t)));

export function deleteTag(id: string) {
  batch(() => {
    tags.value = tags.value.filter((t) => t.id !== id);
    assets.value = assets.value.map((a) => (a.tagIds.includes(id) ? { ...a, tagIds: a.tagIds.filter((t) => t !== id) } : a));
    tagFilter.value = tagFilter.value.filter((t) => t !== id);
  });
}

export const folderById = (id: string | null | undefined) => (id ? folders.value.find((f) => f.id === id) : undefined);
export const tagById = (id: string) => tags.value.find((t) => t.id === id);

/* ------------------------------------------------------------------ */
/* Chats                                                               */
/* ------------------------------------------------------------------ */

export const chatById = (id: string | null) => (id ? chats.value.find((c) => c.id === id) : undefined);

export function updateChat(id: string, fn: (c: Chat) => Chat) {
  chats.value = chats.value.map((c) => (c.id === id ? fn(c) : c));
}

export function updateMessage(chatId: string, msgId: string, fn: (m: Message) => Message) {
  updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)) }));
}

export function deleteChat(id: string) {
  chats.value = chats.value.filter((c) => c.id !== id);
  if (activeChatId.value === id) activeChatId.value = null;
}

export const renameChat = (id: string, title: string) => updateChat(id, (c) => ({ ...c, title: title.trim() || c.title }));

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

export function setDraft(tool: string, key: string, value: unknown) {
  drafts.value = { ...drafts.value, [tool]: { ...drafts.value[tool], [key]: value } };
}
