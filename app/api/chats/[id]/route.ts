import { NextResponse } from "next/server";
import { chatFailure, chatStore, ChatStoreError, deleteChat, isChatId, MAX_CHAT_BYTES, parseChat, saveChat } from "../../../../lib/chats/store";

type Params = { params: Promise<{ id: string }> };

/** Save one chat whole: create it, or replace what was stored under its id. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_CHAT_BYTES) {
      throw new ChatStoreError(`a chat may be at most ${MAX_CHAT_BYTES / 1024 / 1024} MB`, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ChatStoreError("the body is not JSON", 400);
    }
    const chat = parseChat(id, body);
    saveChat(chatStore(request.headers.get("host")), chat);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return chatFailure(error);
  }
}

/** Delete one chat. Deleting a chat that is already gone succeeds too. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!isChatId(id)) {
      throw new ChatStoreError("chat ids are 1-80 letters, digits, '_' or '-'", 400);
    }
    deleteChat(chatStore(request.headers.get("host")), id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return chatFailure(error);
  }
}
