import { NextResponse } from "next/server";

import { status } from "../../../../web/server/runner.mjs";
import { NO_STORE, refuse } from "../guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The studio asks whether Claude Code and Codex are on this computer (web/src/app/local.ts), and
 * which models Codex offers with their effort levels. Off the bridge it answers offline, and the chat
 * keeps OpenRouter and the built-in assistant.
 */
export async function GET(request: Request) {
  const refused = refuse(request, 200);
  if (refused) return refused;
  return NextResponse.json({ ok: true, ...(await status()) }, { headers: NO_STORE });
}
