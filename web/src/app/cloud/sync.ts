// A signed-in account's studio, kept in Supabase. Every asset, folder, tag, chat and cast member is one
// row, plus one row each for the settings and the drafts (see supabase/schema.sql). About a second after
// a change, only the rows that changed go up; a deletion goes up as a "deleted" mark, so other devices
// learn about it too. Other devices' changes come down when the tab comes back into view.
// A change this browser hasn't saved yet wins over the server's; otherwise the server's newest wins.
import { effect } from '@preact/signals';
import { getFile, setRemote } from '../lib/files';
import { SEED } from '../seed';
import { flushState, snapshot, STUDIO_SLOT, studioSettings, switchStudio, type StudioData } from '../store';
import { confirmDialog, dialog } from '../ui/layers';
import { toast } from '../ui/toast';
import { studioKeyFor } from './keys';
import { syncedAt, syncError, syncState, type Account } from './session';
import { BUCKET, supabase, TABLE } from './supabase';

type Kind = 'asset' | 'folder' | 'tag' | 'chat' | 'cast' | 'settings' | 'drafts';
interface Item {
  kind: Kind;
  id: string;
  data: unknown;
}
interface Row extends Item {
  deleted: boolean;
  updated_at: string;
}

const LISTS: Array<[Kind, 'assets' | 'folders' | 'tags' | 'chats' | 'cast']> = [
  ['asset', 'assets'],
  ['folder', 'folders'],
  ['tag', 'tags'],
  ['chat', 'chats'],
  ['cast', 'cast'],
];

const keyOf = (kind: string, id: string) => `${kind}:${id}`;
const metaKey = (uid: string) => `kinemi.sync.v1:${uid}`;

/** The studio as rows. Settings that belong to the device stay out. */
function itemsOf(s: StudioData) {
  const out = new Map<string, Item>();
  for (const [kind, list] of LISTS) for (const x of s[list] as Array<{ id: string }>) out.set(keyOf(kind, x.id), { kind, id: x.id, data: x });
  out.set('settings:me', { kind: 'settings', id: 'me', data: studioSettings(s.settings) });
  out.set('drafts:me', { kind: 'drafts', id: 'me', data: s.drafts });
  return out;
}

/** Rows back into a studio. */
function studioOf(items: Iterable<Item>): Partial<StudioData> {
  const s: StudioData = { assets: [], folders: [], tags: [], chats: [], cast: [], settings: {}, drafts: {} };
  for (const it of items) {
    const list = LISTS.find(([k]) => k === it.kind)?.[1];
    if (list) (s[list] as unknown[]).push(it.data);
    else if (it.kind === 'settings') s.settings = (it.data ?? {}) as StudioData['settings'];
    else if (it.kind === 'drafts') s.drafts = (it.data ?? {}) as StudioData['drafts'];
  }
  // newest first, as the store keeps them
  s.assets.sort((a, b) => b.createdAt - a.createdAt);
  s.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  return s;
}

let uid = '';
/** what the server has, as JSON, by row key */
let synced = new Map<string, string>();
/** the newest updated_at seen, for asking only for what changed */
let cursor = '';
let stopWatch: (() => void) | null = null;
let timer = 0;
let retry = 0;
let busy = false;
let again = false;

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(metaKey(uid)) ?? 'null');
    synced = new Map(Object.entries(m?.synced ?? {}));
    cursor = String(m?.cursor ?? '');
  } catch {
    synced = new Map();
    cursor = '';
  }
}

function saveMeta() {
  try {
    localStorage.setItem(metaKey(uid), JSON.stringify({ synced: Object.fromEntries(synced), cursor }));
  } catch {
    /* storage full: the next sync compares again */
  }
}

const offline = (e: unknown) => /fetch|network|failed to fetch|load failed/i.test(String((e as Error)?.message ?? e));

function failed(e: unknown) {
  const msg = String((e as Error)?.message ?? e);
  if (offline(e)) {
    syncState.value = 'offline';
  } else {
    syncState.value = 'error';
    syncError.value = /relation|does not exist|schema cache/i.test(msg) ? 'The account service has no studio table yet: run supabase/schema.sql in your Supabase project.' : msg;
  }
  clearTimeout(timer);
  retry = Math.min(retry + 1, 5);
  timer = window.setTimeout(() => void push(), [0, 5, 15, 30, 60, 120][retry] * 1000);
}

/** Everything the server has for this account, or only what changed after `since`. */
async function fetchRows(since = ''): Promise<Row[]> {
  const sb = await supabase();
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(TABLE).select('kind,id,data,deleted,updated_at').order('updated_at', { ascending: true }).range(from, from + 999);
    // look back a few seconds: a write that started before the last pull may have landed after it
    if (since) q = q.gt('updated_at', new Date(Date.parse(since) - 10_000).toISOString());
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  for (const r of out) if (r.updated_at > cursor) cursor = r.updated_at;
  return out;
}

/** Put the server's rows on screen, except where this browser has a change of its own still to send. */
function merge(rows: Row[], replace: boolean) {
  const here = itemsOf(snapshot());
  const next = replace ? new Map<string, Item>() : new Map(here);
  for (const r of rows) {
    const key = keyOf(r.kind, r.id);
    const mine = here.get(key);
    const unsent = mine && JSON.stringify(mine.data) !== synced.get(key);
    if (r.deleted) synced.delete(key);
    else synced.set(key, JSON.stringify(r.data));
    if (unsent && !replace) continue;
    if (r.deleted) next.delete(key);
    else next.set(key, { kind: r.kind, id: r.id, data: r.data });
  }
  saveMeta();
  return studioOf(next.values());
}

/** Send what changed since the last sync. */
async function push() {
  if (!uid) return;
  if (busy) {
    again = true;
    return;
  }
  const items = itemsOf(snapshot());
  const changed: Array<Item & { json: string }> = [];
  for (const [key, it] of items) {
    const json = JSON.stringify(it.data);
    if (synced.get(key) !== json) changed.push({ ...it, json });
  }
  const gone = [...synced.keys()].filter((k) => !items.has(k));
  if (!changed.length && !gone.length) {
    if (syncState.value !== 'error') syncState.value = 'saved';
    return;
  }
  busy = true;
  syncState.value = 'saving';
  const me = uid;
  try {
    const sb = await supabase();
    const rows = [
      ...changed.map((c) => ({ user_id: me, kind: c.kind, id: c.id, data: c.data, deleted: false })),
      ...gone.map((k) => {
        const i = k.indexOf(':');
        return { user_id: me, kind: k.slice(0, i), id: k.slice(i + 1), data: {}, deleted: true };
      }),
    ];
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from(TABLE).upsert(rows.slice(i, i + 200), { onConflict: 'user_id,kind,id' });
      if (error) throw new Error(error.message);
    }
    if (me !== uid) return;
    // imported files go up the first time their asset does
    for (const c of changed) {
      if (c.kind !== 'asset' || !(c.data as { file?: unknown }).file || synced.has(keyOf(c.kind, c.id))) continue;
      const blob = await getFile(c.id).catch(() => null);
      if (blob) await sb.storage.from(BUCKET).upload(`${me}/${c.id}`, blob, { upsert: true, contentType: blob.type || undefined });
    }
    for (const c of changed) synced.set(keyOf(c.kind, c.id), c.json);
    for (const k of gone) synced.delete(k);
    saveMeta();
    retry = 0;
    syncError.value = '';
    syncedAt.value = Date.now();
    syncState.value = 'saved';
  } catch (e) {
    failed(e);
  } finally {
    busy = false;
    if (again) {
      again = false;
      schedule(400);
    }
  }
}

function schedule(ms = 1200) {
  clearTimeout(timer);
  timer = window.setTimeout(() => void push(), ms);
}

async function pull() {
  if (!uid || document.hidden) return;
  try {
    const rows = await fetchRows(cursor);
    if (rows.length) switchStudio(studioKeyFor(uid), merge(rows, false));
    await push();
  } catch (e) {
    failed(e);
  }
}

const onVisible = () => {
  if (!document.hidden) void pull();
};

/** Ask whether a guest studio in this browser should come along into a new account. */
function offerGuestStudio(): Promise<Partial<StudioData> | null> {
  let guest: Partial<StudioData> | null = null;
  try {
    guest = JSON.parse(localStorage.getItem(STUDIO_SLOT) ?? 'null');
  } catch {
    guest = null;
  }
  const seedIds = new Set([...SEED.assets, ...SEED.chats, ...SEED.folders, ...SEED.tags, ...SEED.cast].map((x) => x.id));
  const own = (list?: Array<{ id: string }>) => (list ?? []).filter((x) => !seedIds.has(x.id)).length;
  const renders = own(guest?.assets);
  const talks = own(guest?.chats);
  if (!guest || renders + talks + own(guest.folders) + own(guest.cast) === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let answer: Partial<StudioData> | null = null;
    confirmDialog('Bring this browser’s studio into your account?', {
      body: `As a guest you made ${renders} ${renders === 1 ? 'render' : 'renders'} and ${talks} ${talks === 1 ? 'chat' : 'chats'} here. Bring them along, and they follow your account to every device.`,
      cta: 'Bring them along',
      cancel: 'Start fresh',
      onConfirm: () => (answer = guest),
    });
    // closed either way: with the button, or with Esc, the backdrop or “Start fresh”
    const stop = effect(() => {
      if (dialog.value) return;
      setTimeout(() => stop());
      resolve(answer);
    });
  });
}

/** Signed in: load the account's studio, then keep it in step. */
export async function startSync(me: Account) {
  stopSync();
  uid = me.id;
  loadMeta();
  // this browser has synced this account before: its cached copy is real, not just the sample studio
  const cached = !!cursor || synced.size > 0;
  // the cached copy first, so the studio is there at once; the seed until the first visit has loaded
  switchStudio(studioKeyFor(uid));
  syncState.value = 'loading';
  setRemote({
    put: async (id, blob) => {
      const sb = await supabase();
      await sb.storage.from(BUCKET).upload(`${uid}/${id}`, blob, { upsert: true, contentType: blob.type || undefined });
    },
    get: async (id) => {
      const sb = await supabase();
      const { data } = await sb.storage.from(BUCKET).download(`${uid}/${id}`);
      return data ?? null;
    },
    remove: async (ids) => {
      const sb = await supabase();
      await sb.storage.from(BUCKET).remove(ids.map((id) => `${uid}/${id}`));
    },
  });
  try {
    const rows = await fetchRows(cached ? cursor : '');
    if (uid !== me.id) return;
    if (!cached && !rows.length) {
      // a new account: the guest's studio if they want it, else the sample studio
      const guest = await offerGuestStudio();
      if (uid !== me.id) return;
      synced = new Map();
      switchStudio(studioKeyFor(uid), guest ?? null);
      if (guest) toast({ title: 'Your studio came along', body: 'It’s saved to your account now.' });
    } else if (rows.length) {
      switchStudio(studioKeyFor(uid), merge(rows, !cached));
    }
  } catch (e) {
    failed(e);
  }
  stopWatch = effect(() => {
    snapshot();
    schedule();
  });
  document.addEventListener('visibilitychange', onVisible);
  await push();
}

/** Signed out: stop syncing and put this browser's own studio back on screen. */
export function stopSync({ toGuest = false } = {}) {
  if (uid) {
    flushState();
    saveMeta();
  }
  stopWatch?.();
  stopWatch = null;
  clearTimeout(timer);
  document.removeEventListener('visibilitychange', onVisible);
  setRemote(null);
  uid = '';
  syncState.value = 'off';
  if (toGuest) switchStudio(STUDIO_SLOT);
}

/** Settings → Data: empty the account's studio on every device. The account itself stays. */
export async function wipeAccountStudio() {
  if (!uid) return;
  switchStudio(studioKeyFor(uid), { assets: [], folders: [], tags: [], chats: [], cast: [], settings: {}, drafts: {} });
  await push();
  try {
    const sb = await supabase();
    const files = await sb.storage.from(BUCKET).list(uid, { limit: 1000 });
    const paths = (files.data ?? []).map((f) => `${uid}/${f.name}`);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  } catch {
    /* files that stay behind are removed with the account */
  }
  toast({ title: 'Your studio is empty', body: 'On every device, once they next sync.' });
}

export const syncNow = () => pull();

