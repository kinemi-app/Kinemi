import type { DatabaseSync } from "node:sqlite";
import { ChatStoreError, isChatId } from "../chats/store";

/**
 * The studio's asset library (assets, folders, tags) and imported files, kept in the same
 * SQLite file as the chats. The studio reads and writes an item whole, so its data is one JSON
 * column; only "a JSON object of a sane size" is checked.
 */
export const LIBRARY_KINDS = ["asset", "folder", "tag"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export type LibraryItem = Record<string, unknown>;
export type Library = { assets: LibraryItem[]; folders: LibraryItem[]; tags: LibraryItem[] };
export type StoredFile = { type: string; size: number; bytes: Uint8Array };

/** One library item's body may not be bigger than this. */
export const MAX_ITEM_BYTES = 4 * 1024 * 1024;
/** One imported file may not be bigger than this. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const FALLBACK_TYPE = "application/octet-stream";
const ID_RULE = "ids are 1-80 letters, digits, '_' or '-'";

export const isLibraryKind = (kind: string): kind is LibraryKind => (LIBRARY_KINDS as readonly string[]).includes(kind);

const startsWith = (bytes: Uint8Array, at: number, text: string) =>
  bytes.length >= at + text.length && [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

const startsWithBytes = (bytes: Uint8Array, signature: number[]) =>
  bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);

/** The media type of these bytes, read from their magic number; the file name is not trusted. */
export function sniffType(bytes: Uint8Array): string {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, 0, "GIF8")) return "image/gif";
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) return "image/webp";
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WAVE")) return "audio/wav";
  if (startsWith(bytes, 4, "ftyp")) return "video/mp4";
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (startsWith(bytes, 0, "OggS")) return "audio/ogg";
  // An MP3 starts with an ID3 tag or straight with a frame sync (eleven set bits).
  if (startsWith(bytes, 0, "ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "audio/mpeg";
  return FALLBACK_TYPE;
}

/** The kind of a path, once it and the id are known good; otherwise a 400 that says which is not. */
export function parseKey(kind: string, id: string): LibraryKind {
  if (!isLibraryKind(kind)) throw new ChatStoreError(`the kind must be one of ${LIBRARY_KINDS.join(", ")}`, 400);
  if (!isChatId(id)) throw new ChatStoreError(`library ${ID_RULE}`, 400);
  return kind;
}

/** The item's data from a PUT body, or a 400 that says what is wrong with it. */
export function parseItem(body: unknown): LibraryItem {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ChatStoreError("the body must be a JSON object", 400);
  }
  return body as LibraryItem;
}

/** The checked file id of a path, or a 400. */
export function parseFileId(id: string): string {
  if (!isChatId(id)) throw new ChatStoreError(`file ${ID_RULE}`, 400);
  return id;
}

function dataOf(json: string): LibraryItem[] {
  try {
    const item: unknown = JSON.parse(json);
    return item && typeof item === "object" && !Array.isArray(item) ? [item as LibraryItem] : [];
  } catch {
    return [];
  }
}

/** Everything in the library, most recently saved first. */
export function listLibrary(store: DatabaseSync): Library {
  const rows = store.prepare("SELECT kind, data FROM library ORDER BY updated_at DESC, id").all() as { kind: string; data: string }[];
  const library: Library = { assets: [], folders: [], tags: [] };
  for (const row of rows) {
    const target = row.kind === "asset" ? library.assets : row.kind === "folder" ? library.folders : row.kind === "tag" ? library.tags : undefined;
    target?.push(...dataOf(row.data));
  }
  return library;
}

export function putItem(store: DatabaseSync, kind: LibraryKind, id: string, data: LibraryItem): void {
  store
    .prepare(
      `INSERT INTO library (kind, id, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(kind, id, JSON.stringify(data), Date.now());
}

export function deleteItem(store: DatabaseSync, kind: LibraryKind, id: string): void {
  store.prepare("DELETE FROM library WHERE kind = ? AND id = ?").run(kind, id);
}

/** Store a file whole under its id, replacing what was there. Returns the type read from its bytes. */
export function putFile(store: DatabaseSync, id: string, bytes: Uint8Array): { type: string; size: number } {
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ChatStoreError(`a file may be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`, 413);
  }
  const type = sniffType(bytes);
  store
    .prepare(
      `INSERT INTO files (id, type, size, bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, size = excluded.size, bytes = excluded.bytes`,
    )
    .run(id, type, bytes.length, bytes);
  return { type, size: bytes.length };
}

export function getFile(store: DatabaseSync, id: string): StoredFile | undefined {
  const row = store.prepare("SELECT type, size, bytes FROM files WHERE id = ?").get(id) as
    | { type: string; size: number; bytes: Uint8Array }
    | undefined;
  return row && { type: row.type, size: Number(row.size), bytes: row.bytes };
}

export function deleteFile(store: DatabaseSync, id: string): void {
  store.prepare("DELETE FROM files WHERE id = ?").run(id);
}
