import { NextResponse } from "next/server";
import {
  MAX_PATCH_BYTES,
  MAX_PATCH_TYPE_LENGTH,
  isValidRoomId,
  parseClientId,
  parsePatchInput,
} from "../protocol";
import { getOrCreateRoom, isRoomFull, publishPatch } from "../rooms";
import { openRoomStream } from "../stream";

const ROOM_ID_HINT = "the room id must be 1-64 letters, digits, '-' or '_'";
const CLIENT_ID_HINT = "clientId must be 1-64 letters, digits, '-' or '_'";
const PATCH_BYTES_HINT = `a patch body is at most ${MAX_PATCH_BYTES / 1024} KB`;
const PATCH_TYPE_HINT = `"patch.type" must be a string of 1-${MAX_PATCH_TYPE_LENGTH} characters`;
const ROOMS_FULL = "the server holds the maximum number of rooms";
const ROOM_FULL = "the room is full; try another room";

/**
 * GET /api/collab/:room?clientId=... — the room as server-sent events. A new subscriber gets
 * "hello" with the peers and the patch log, then "presence" and "patch" frames as they happen.
 */
export async function GET(request: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room: roomId } = await params;
  if (!isValidRoomId(roomId)) {
    return NextResponse.json({ error: ROOM_ID_HINT }, { status: 400 });
  }
  const clientId = parseClientId(new URL(request.url).searchParams.get("clientId"));
  if (!clientId) {
    return NextResponse.json({ error: CLIENT_ID_HINT }, { status: 400 });
  }

  const room = getOrCreateRoom(roomId);
  if (!room) {
    return NextResponse.json({ error: ROOMS_FULL }, { status: 503 });
  }
  if (isRoomFull(room, clientId)) {
    return NextResponse.json({ error: ROOM_FULL }, { status: 503 });
  }

  const stream = openRoomStream(room, roomId, clientId);
  // "cancel" inside the stream covers a disconnect; this covers an abort that never reaches it.
  request.signal.addEventListener("abort", stream.close);
  return stream.response;
}

/**
 * POST /api/collab/:room — publish one board patch to everyone in the room. The clientId is
 * self-asserted; a room has no accounts, so it names the author and nothing more.
 */
export async function POST(request: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room: roomId } = await params;
  if (!isValidRoomId(roomId)) {
    return NextResponse.json({ error: ROOM_ID_HINT }, { status: 400 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PATCH_BYTES) {
    return NextResponse.json({ error: PATCH_BYTES_HINT }, { status: 413 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_PATCH_BYTES) {
    return NextResponse.json({ error: PATCH_BYTES_HINT }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const { clientId: rawClientId, patch: rawPatch } = body as Record<string, unknown>;
  const clientId = parseClientId(rawClientId);
  if (!clientId) {
    return NextResponse.json({ error: CLIENT_ID_HINT }, { status: 400 });
  }
  const patch = parsePatchInput(rawPatch);
  if (!patch) {
    return NextResponse.json({ error: PATCH_TYPE_HINT }, { status: 400 });
  }

  const room = getOrCreateRoom(roomId);
  if (!room) {
    return NextResponse.json({ error: ROOMS_FULL }, { status: 503 });
  }
  const stored = publishPatch(room, clientId, patch);
  return NextResponse.json({ seq: stored.seq, at: stored.at });
}
