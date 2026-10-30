import { NextResponse } from "next/server";
import { chatFailure, chatStore, ChatStoreError } from "../../../../../lib/chats/store";
import { deleteItem, MAX_ITEM_BYTES, parseItem, parseKey, putItem } from "../../../../../lib/library/store";

type Params = { params: Promise<{ kind: string; id: string }> };

/** Save one library item whole: create it, or replace what was stored under its kind and id. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { kind, id } = await params;
    const checkedKind = parseKey(kind, id);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_ITEM_BYTES) {
      throw new ChatStoreError(`a library item may be at most ${MAX_ITEM_BYTES / 1024 / 1024} MB`, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ChatStoreError("the body is not JSON", 400);
    }
    putItem(chatStore(request.headers.get("host")), checkedKind, id, parseItem(body));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return chatFailure(error);
  }
}

/** Delete one library item. Deleting an item that is already gone succeeds too. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { kind, id } = await params;
    deleteItem(chatStore(request.headers.get("host")), parseKey(kind, id), id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return chatFailure(error);
  }
}
