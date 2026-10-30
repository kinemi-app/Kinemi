import { NextResponse } from "next/server";
import { chatFailure, chatStore, listChats } from "../../../lib/chats/store";

export const dynamic = "force-dynamic";

/** Every chat on this computer, newest first. */
export function GET(request: Request) {
  try {
    return NextResponse.json({ chats: listChats(chatStore(request.headers.get("host"))) });
  } catch (error) {
    return chatFailure(error);
  }
}
