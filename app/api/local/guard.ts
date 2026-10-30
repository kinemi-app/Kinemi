import { NextResponse } from "next/server";

/**
 * Who may use the chat's Claude Code / Codex bridge on this server: only this computer.
 * The real guard is the listening address. scripts/start.mjs sets KINEMI_LOCAL_CLI_BOUND=1 only
 * when Next listens on 127.0.0.1 alone (lib/runtime/bridge.mjs). The Host and Origin checks then keep
 * other websites out: a page that renames itself localhost (DNS rebinding), or one posting to it.
 */
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

export const OFFLINE = {
  ok: false,
  error: "offline",
  message: "This Kinemi server has no Claude Code or Codex chat bridge: start it with npm start on this computer.",
} as const;

/** A response refusing the request, or null when this computer may use the bridge. */
export function refuse(request: Request, offlineStatus: number): NextResponse | null {
  if (process.env.KINEMI_LOCAL_CLI_BOUND !== "1") return NextResponse.json(OFFLINE, { status: offlineStatus });
  const host = request.headers.get("host") ?? "";
  if (!LOOPBACK_HOST.test(host)) return NextResponse.json({ error: "host" }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== `http://${host}`) return NextResponse.json({ error: "origin" }, { status: 403 });
  return null;
}

export const NO_STORE = { "Cache-Control": "no-store" };
