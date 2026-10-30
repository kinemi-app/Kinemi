// Imported files live in IndexedDB, keyed by asset id; the asset store only keeps their metadata.
// Signed in to an account, they also go to the account's file storage (see cloud/sync.ts), and a file
// this browser doesn't have yet comes down from there the first time it is shown.

const DB = 'kinemi-files';
const STORE = 'files';
let dbp: Promise<IDBDatabase> | null = null;
const urls = new Map<string, string>();

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Where an account keeps its files; null without one. */
export interface Remote {
  put: (id: string, blob: Blob) => Promise<void>;
  get: (id: string) => Promise<Blob | null>;
  remove: (ids: string[]) => Promise<void>;
}

let remote: Remote | null = null;
export const setRemote = (r: Remote | null) => (remote = r);

/** Keep a file in this browser only, without sending it anywhere. */
export const cacheFile = (id: string, blob: Blob) => run('readwrite', (s) => s.put(blob, id));

export async function putFile(id: string, blob: Blob) {
  await cacheFile(id, blob);
  if (!remote) return;
  try {
    // wait for the server copy: otherwise a reload can list an asset whose bytes never arrived
    await remote.put(id, blob);
  } catch (e) {
    // the import adds no asset row when this throws; drop the bytes so no orphan copy stays behind
    await run('readwrite', (s) => s.delete(id)).catch(() => {});
    throw e;
  }
}

export const getFile = (id: string) => run<Blob | undefined>('readonly', (s) => s.get(id)).then((b) => b ?? null);

export async function fileURL(id: string) {
  const hit = urls.get(id);
  if (hit) return hit;
  let blob = (await run<Blob | undefined>('readonly', (s) => s.get(id))) ?? null;
  if (!blob && remote) {
    blob = await remote.get(id).catch(() => null);
    if (blob) await cacheFile(id, blob).catch(() => {});
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export async function removeFile(id: string) {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  await run('readwrite', (s) => s.delete(id));
  remote?.remove([id]).catch(() => {});
}
