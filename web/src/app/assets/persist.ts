// The studio's asset library (assets, folders, tags) lives in the local server's SQLite file.
// Every library action already writes the `assets`, `folders` and `tags` signals; this module saves
// the items that changed and deletes the ones that went, a moment later. Imported file bytes go to
// the same server, so another browser can open them; the library itself is not kept in localStorage.
import { effect } from '@preact/signals';
import {
  BackendError,
  getLibrary,
  getServerFile,
  putServerFile,
  removeLibraryItem,
  removeServerFile,
  saveLibraryItem,
  type Library,
  type LibraryKind,
} from '../backend';
import { setRemote } from '../lib/files';
import { assets, assetsOnServer, folders, tags, type Asset, type Folder, type Tag } from '../store';
import { toast } from '../ui/toast';

const SAVE_MS = 400;
const RETRY_MS = 5000;

type Item = Asset | Folder | Tag;

interface SavedItem {
  kind: LibraryKind;
  item: Item;
}

/** What the server holds, by `kind:id`: the exact objects last saved, so an unchanged item is skipped. */
let saved = new Map<string, SavedItem>();
let timer = 0;
let busy = false;
let started = false;

const keyOf = (kind: LibraryKind, id: string) => `${kind}:${id}`;

const reasonOf = (e: unknown) => (e instanceof BackendError ? e.message : e instanceof Error ? e.message : String(e));

/** Every item on screen, marked with the library kind its collection is saved as. */
const current = (): SavedItem[] => [
  ...assets.value.map((item) => ({ kind: 'asset' as const, item })),
  ...folders.value.map((item) => ({ kind: 'folder' as const, item })),
  ...tags.value.map((item) => ({ kind: 'tag' as const, item })),
];

function changes() {
  const now = new Map(current().map((entry) => [keyOf(entry.kind, entry.item.id), entry]));
  const put = [...now.values()].filter((entry) => saved.get(keyOf(entry.kind, entry.item.id))?.item !== entry.item);
  const gone = [...saved.entries()].filter(([key]) => !now.has(key)).map(([, entry]) => entry);
  return { put, gone };
}

function schedule(ms = SAVE_MS) {
  clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), ms);
}

async function flush(keepalive = false) {
  clearTimeout(timer);
  if (busy && !keepalive) return schedule();
  const { put, gone } = changes();
  if (!put.length && !gone.length) {
    assetsOnServer.value = true;
    return;
  }
  busy = true;
  const results = await Promise.allSettled([
    ...put.map(({ kind, item }) => saveLibraryItem(kind, item, keepalive).then(() => void saved.set(keyOf(kind, item.id), { kind, item }))),
    ...gone.map(({ kind, item }) => removeLibraryItem(kind, item.id, keepalive).then(() => void saved.delete(keyOf(kind, item.id)))),
  ]);
  busy = false;
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    // the browser keeps its copy until the server takes it again
    if (assetsOnServer.value) toast({ title: 'Assets aren’t being saved', body: reasonOf(failed.reason) });
    assetsOnServer.value = false;
    return schedule(RETRY_MS);
  }
  assetsOnServer.value = true;
  const left = changes();
  if (left.put.length || left.gone.length) schedule();
}

/** The server is local, so a failed read is usually a moment, not a wall: try again before giving up. */
async function loadLibrary(): Promise<Library | null> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await getLibrary();
    } catch (e) {
      if (attempt === 3) {
        toast({ title: 'The asset library isn’t loading', body: reasonOf(e) });
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  return null;
}

/** Load the library from the server, keep imported files there, then save every change. */
export async function startLibraryStore(): Promise<void> {
  if (started) return;
  started = true;
  const loaded = await loadLibrary();
  if (!loaded) return;
  const savedFrom = (kind: LibraryKind, list: Item[]) => list.map((item) => [keyOf(kind, item.id), { kind, item }] as const);
  saved = new Map([...savedFrom('asset', loaded.assets), ...savedFrom('folder', loaded.folders), ...savedFrom('tag', loaded.tags)]);
  const serverEmpty = !loaded.assets.length && !loaded.folders.length && !loaded.tags.length;
  if (serverEmpty) {
    // upgrading from the browser-only studio: an empty server takes what this browser already has,
    // minus the sample renders an old build left behind
    assets.value = assets.value.filter((asset) => asset.source !== 'seed');
  } else {
    assets.value = loaded.assets;
    folders.value = loaded.folders;
    tags.value = loaded.tags;
  }
  // assetsOnServer stays false until the first flush succeeds, so the browser's saved copy
  // is not thrown away before the server holds the library
  setRemote({
    put: async (id, blob) => {
      await putServerFile(id, blob);
    },
    get: getServerFile,
    remove: async (ids) => {
      await Promise.all(ids.map((id) => removeServerFile(id)));
    },
  });
  effect(() => {
    void assets.value;
    void folders.value;
    void tags.value;
    schedule();
  });
  addEventListener('pagehide', () => void flush(true));
}
