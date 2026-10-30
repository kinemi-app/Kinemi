import { NextResponse } from "next/server";
import { chatFailure, chatStore } from "../../../lib/chats/store";
import { listLibrary } from "../../../lib/library/store";

export const dynamic = "force-dynamic";

/** The whole library on this computer: assets, folders and tags. */
export function GET(request: Request) {
  try {
    return NextResponse.json(listLibrary(chatStore(request.headers.get("host"))));
  } catch (error) {
    return chatFailure(error);
  }
}
