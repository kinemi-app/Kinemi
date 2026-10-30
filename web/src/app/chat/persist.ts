// The studio's chats live in the local server's SQLite file. Every chat action already writes
// `chats`; this module saves the chats that changed and deletes the ones that went, a moment later.
// If the server can't keep them, the browser keeps them as before and the sidebar says why.
import { effect, signal } from '@preact/signals';
import { BackendError, listChats, removeChat, saveChat } from '../backend';
import { chats, chatsOnServer, settle, type Chat } from '../store';
import { toast } from '../ui/toast';

/** Why the server isn't keeping the chats, or null while it is (or is still answering). */
export const chatStoreProblem = signal<string | null>(null);

/** The sample chats older versions saved in this browser. They are not the owner's and never move. */
const OLD_SAMPLES = new Set(['ch-neon', 'ch-motel', 'ch-dance', 'ch-ss27']);
const SAVE_MS = 400;
const RETRY_MS = 5000;

/** What the server holds, by id: the exact objects last saved, so an unchanged chat is skipped. */
let saved = new Map<string, Chat>();
let timer = 0;
let busy = false;
let started = false;

const reasonOf = (e: unknown) => (e instanceof BackendError ? e.message : e instanceof Error ? e.message : String(e));

function changes() {
  const now = new Map(chats.value.map((c) => [c.id, c]));
  const put = [...now.values()].filter((c) => saved.get(c.id) !== c);
  const gone = [...saved.keys()].filter((id) => !now.has(id));
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
    chatsOnServer.value = true;
    return;
  }
  busy = true;
  const results = await Promise.allSettled([
    ...put.map((c) => saveChat(c, keepalive).then(() => void saved.set(c.id, c))),
    ...gone.map((id) => removeChat(id, keepalive).then(() => void saved.delete(id))),
  ]);
  busy = false;
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    // keep a copy in the browser until the server takes them again
    if (chatsOnServer.value) toast({ title: 'Chats aren’t being saved', body: reasonOf(failed.reason) });
    chatsOnServer.value = false;
    return schedule(RETRY_MS);
  }
  chatsOnServer.value = true;
  const left = changes();
  if (left.put.length || left.gone.length) schedule();
}

/** Load the chats from the server, move this browser's own chats there once, then save every change. */
export async function startChatStore() {
  if (started) return;
  started = true;
  const local = chats.value.filter((c) => !OLD_SAMPLES.has(c.id));
  chats.value = local;
  let loaded: Chat[];
  try {
    loaded = (await listChats()).map(settle);
  } catch (e) {
    chatStoreProblem.value = reasonOf(e);
    return;
  }
  saved = new Map(loaded.map((c) => [c.id, c]));
  // the server's copy wins; chats only this browser has (or made while loading) get uploaded
  chats.value = [...chats.value.filter((c) => !saved.has(c.id)), ...loaded];
  effect(() => {
    void chats.value;
    schedule();
  });
  addEventListener('pagehide', () => void flush(true));
}
