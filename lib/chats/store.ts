import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * The studio's chats, kept in one SQLite file on this computer. The studio reads and writes a
 * chat whole, so its messages are one JSON column; only the fields every message has are checked.
 */
export type StoredMessage = { id: string; role: "user" | "assistant"; text: string; at: number } & Record<string, unknown>;
export type StoredChat = { id: string; title: string; createdAt: number; updatedAt: number; messages: StoredMessage[] };

/** One chat's request body may not be bigger than this. */
export const MAX_CHAT_BYTES = 4 * 1024 * 1024;
const MAX_TITLE = 300;
// v2 added the library and files tables; every table is created if missing, so a v1 file
// keeps its chats and a fresh file lands on v2 in the same step.
const SCHEMA_VERSION = 2;
const CHAT_ID = /^[\w-]{1,80}$/;
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

const REMOTE =
  "Chats are stored on this computer only. Set KINEMI_DB in .env to store them on this server.";

export class ChatStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const isChatId = (id: string) => CHAT_ID.test(id);

export const defaultChatDbPath = () => join(homedir(), ".kinemi", "kinemi.sqlite");

let db: DatabaseSync | undefined;
let openPath = "";

/** The host name of a Host header, without its port. */
function hostName(host: string | null): string {
  const value = (host ?? "").trim();
  if (value.startsWith("[")) {
    return value.slice(0, value.indexOf("]") + 1);
  }
  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

function open(path: string): DatabaseSync {
  if (db && openPath === path) {
    return db;
  }
  db?.close();
  db = undefined;
  mkdirSync(dirname(path), { recursive: true });
  // Loaded at run time so no bundler has to know the module.
  const { DatabaseSync: Database } = process.getBuiltinModule("node:sqlite");
  const next = new Database(path);
  const version = Number(next.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (version > SCHEMA_VERSION) {
    next.close();
    throw new Error(`${path} was written by a newer Kinemi (schema ${version})`);
  }
  next.exec("PRAGMA journal_mode = WAL");
  next.exec("PRAGMA busy_timeout = 2000");
  next.exec(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    messages TEXT NOT NULL
  )`);
  next.exec(`CREATE TABLE IF NOT EXISTS library (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
  )`);
  next.exec(`CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    bytes BLOB NOT NULL
  )`);
  next.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  db = next;
  openPath = path;
  return next;
}

/**
 * The chat database for a request with this Host header. Without KINEMI_DB the default file
 * serves only requests made on this computer; anything else must name its own file.
 */
export function chatStore(host: string | null): DatabaseSync {
  const configured = process.env.KINEMI_DB?.trim();
  if (!configured && !LOOPBACK.test(hostName(host))) {
    throw new ChatStoreError(REMOTE, 503);
  }
  const path = configured ? resolve(configured) : defaultChatDbPath();
  try {
    return open(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ChatStoreError(`The chat database at ${path} could not be opened: ${reason}. Set KINEMI_DB in .env to a writable file.`, 503);
  }
}

type Row = { id: string; title: string; created_at: number; updated_at: number; messages: string };

function messagesOf(json: string): StoredMessage[] {
  try {
    const list: unknown = JSON.parse(json);
    return Array.isArray(list) ? (list as StoredMessage[]) : [];
  } catch {
    return [];
  }
}

export function listChats(store: DatabaseSync): StoredChat[] {
  const rows = store.prepare("SELECT id, title, created_at, updated_at, messages FROM chats ORDER BY updated_at DESC").all() as Row[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    messages: messagesOf(row.messages),
  }));
}

export function saveChat(store: DatabaseSync, chat: StoredChat): void {
  store
    .prepare(
      `INSERT INTO chats (id, title, created_at, updated_at, messages) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, created_at = excluded.created_at,
       updated_at = excluded.updated_at, messages = excluded.messages`,
    )
    .run(chat.id, chat.title, Math.round(chat.createdAt), Math.round(chat.updatedAt), JSON.stringify(chat.messages));
}

export function deleteChat(store: DatabaseSync, id: string): void {
  store.prepare("DELETE FROM chats WHERE id = ?").run(id);
}

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function badMessage(m: unknown, i: number): string | undefined {
  if (!m || typeof m !== "object") return `message ${i} is not an object`;
  const { id, role, text, at } = m as Record<string, unknown>;
  if (typeof id !== "string" || !id) return `message ${i} has no id`;
  if (role !== "user" && role !== "assistant") return `message ${i} has role ${String(role)}, not user or assistant`;
  if (typeof text !== "string") return `message ${i} has no text`;
  if (!isTime(at)) return `message ${i} has no time`;
  return undefined;
}

/** A chat from a PUT body, or a 400 that says what is wrong with it. */
export function parseChat(id: string, body: unknown): StoredChat {
  const fail = (why: string) => new ChatStoreError(why, 400);
  if (!isChatId(id)) throw fail("chat ids are 1-80 letters, digits, '_' or '-'");
  if (!body || typeof body !== "object") throw fail("the body must be a chat object");
  const chat = body as Record<string, unknown>;
  if (chat.id !== id) throw fail("the chat's id does not match the path");
  if (typeof chat.title !== "string" || !chat.title.trim() || chat.title.length > MAX_TITLE) {
    throw fail(`a title is 1-${MAX_TITLE} characters`);
  }
  if (!isTime(chat.createdAt) || !isTime(chat.updatedAt)) throw fail("createdAt and updatedAt must be times in ms");
  if (!Array.isArray(chat.messages)) throw fail("messages must be a list");
  const why = chat.messages.map(badMessage).find(Boolean);
  if (why) throw fail(why);
  return { id, title: chat.title.trim(), createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.messages as StoredMessage[] };
}

/** The response for anything a chat route throws. */
export function chatFailure(error: unknown): Response {
  if (error instanceof ChatStoreError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return Response.json({ error: `the chat store failed: ${reason}` }, { status: 500 });
}
