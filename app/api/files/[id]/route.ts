import { NextResponse } from "next/server";
import { chatFailure, chatStore, ChatStoreError } from "../../../../lib/chats/store";
import { deleteFile, getFile, MAX_FILE_BYTES, parseFileId, putFile } from "../../../../lib/library/store";

type Params = { params: Promise<{ id: string }> };

const TOO_BIG = new ChatStoreError(`a file may be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`, 413);

/** The request's raw body, read chunk by chunk so a body over the cap is refused before it is all in memory. */
async function readCapped(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_FILE_BYTES) throw TOO_BIG;
  if (!request.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > MAX_FILE_BYTES) throw TOO_BIG;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The file's bytes, with the type read from them when they were stored. */
export async function GET(request: Request, { params }: Params) {
  try {
    const id = parseFileId((await params).id);
    const file = getFile(chatStore(request.headers.get("host")), id);
    if (!file) throw new ChatStoreError("no such file", 404);
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "content-type": file.type,
        "content-length": String(file.size),
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return chatFailure(error);
  }
}

/** Save one file whole under its id; the body is the file's raw bytes. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const id = parseFileId((await params).id);
    const bytes = await readCapped(request);
    return NextResponse.json({ ok: true, ...putFile(chatStore(request.headers.get("host")), id, bytes) });
  } catch (error) {
    return chatFailure(error);
  }
}

/** Delete one file. Deleting a file that is already gone succeeds too. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    deleteFile(chatStore(request.headers.get("host")), parseFileId((await params).id));
    return new Response(null, { status: 204 });
  } catch (error) {
    return chatFailure(error);
  }
}
