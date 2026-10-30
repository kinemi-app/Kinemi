import { NextResponse } from "next/server";

import { cleanKey } from "../../../../web/src/app/keys";
import { NO_STORE, refuse } from "../guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COMFY_CLOUD = String(process.env.KINEMI_COMFY_CLOUD_URL || "https://cloud.comfy.org").replace(/\/+$/, "");
const MAX_KEY_LENGTH = 400;
const CHECK_TIMEOUT_MS = 10_000;
/** web/src/app/compute.ts trusts an answer as this server's only when it carries this header. */
const PROXIED = { ...NO_STORE, "X-Kinemi-Proxy": "1" };

/**
 * Settings → Keys you bring → Comfy Cloud → Test (web/src/app/compute.ts testCloud). Comfy Cloud
 * doesn't take calls from web pages, so this server asks GET /api/user for the page and hands back
 * Cloud's answer as it is. Only ever that one request: a key check, not an open proxy. Same guard as
 * the chat bridge, and the same handler as the static bridge in web/server/local.mjs.
 */
export async function GET(request: Request) {
  const refused = refuse(request, 200);
  if (refused) return refused;
  const key = cleanKey(request.headers.get("x-api-key") ?? "");
  if (!key || key.length > MAX_KEY_LENGTH) return NextResponse.json({ error: "key" }, { status: 400, headers: PROXIED });
  try {
    // redirect "error": fetch keeps a custom X-API-Key header across hosts, so a redirect could hand the key elsewhere
    const r = await fetch(`${COMFY_CLOUD}/api/user`, {
      headers: { "X-API-Key": key },
      redirect: "error",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    const body = await r.text();
    return new NextResponse(body || "{}", { status: r.status, headers: { ...PROXIED, "Content-Type": "application/json" } });
  } catch {
    // offline, or Cloud didn't answer in time: the studio shows "Couldn't reach Comfy Cloud"
    return NextResponse.json({ error: "unreachable" }, { status: 502, headers: PROXIED });
  }
}
