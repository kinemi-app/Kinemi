import { NextResponse } from "next/server";

import { ask, checkChat } from "../../../../web/server/runner.mjs";
import { NO_STORE, refuse } from "../guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 256_000;

/**
 * One chat turn through Claude Code or Codex on this computer (web/src/app/local.ts askLocal).
 * The same checks as web/server/local.mjs: JSON only, a size cap, and runner.mjs's checkChat.
 */
export async function POST(request: Request) {
  const refused = refuse(request, 503);
  if (refused) return refused;
  if (!String(request.headers.get("content-type")).startsWith("application/json")) {
    return NextResponse.json({ error: "json-only" }, { status: 415 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "too-large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const checked = await checkChat(body);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: checked.status });
  try {
    // request.signal aborts when the page goes away, and the runner then stops the CLI
    const out = await ask(checked.request, { signal: request.signal });
    return NextResponse.json({ ok: true, ...out }, { headers: NO_STORE });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json({ error: err.code ?? "cli-error", message: String(err.message ?? "").slice(0, 400) }, { status: 502 });
  }
}
