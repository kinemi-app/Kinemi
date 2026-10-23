/**
 * The wire contract of the canvas collab room: the ids it accepts, the patch it stores and the
 * server-sent event framing. It is pure, so the route and the room store share one source.
 */

/** Room and client ids travel in URLs, so they stay to letters, digits, '-' and '_'. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A patch body a client publishes: one board operation, with its payload left opaque. */
export type CollabPatchInput = {
  type: string;
  data?: unknown;
};

/** A patch as the room stores and streams it: the input plus the room sequence and the author. */
export type CollabPatch = CollabPatchInput & {
  seq: number;
  clientId: string;
  at: number;
};

/** One patch body is capped like a large board operation; the history keeps the newest ones. */
export const MAX_PATCH_BYTES = 64 * 1024;
export const MAX_PATCH_TYPE_LENGTH = 64;
export const MAX_HISTORY = 200;
export const MAX_CLIENTS_PER_ROOM = 32;
export const MAX_ROOMS = 64;
/** SSE comments are cheap and EventSource ignores them; proxies use them to keep the socket. */
export const HEARTBEAT_MS = 25_000;

export function isValidRoomId(roomId: string): boolean {
  return ID_PATTERN.test(roomId);
}

/** The client id is self-asserted: it names a patch author, it is not a credential. */
export function parseClientId(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

/** A patch needs a named operation; its data stays whatever JSON the board sent. */
export function parsePatchInput(value: unknown): CollabPatchInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const { type, data } = value as Record<string, unknown>;
  if (typeof type !== "string" || type.trim() === "" || type.length > MAX_PATCH_TYPE_LENGTH) {
    return null;
  }
  return data === undefined ? { type } : { type, data };
}

/** One SSE frame. JSON.stringify escapes newlines, so a payload never splits its own frame. */
export function formatEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
