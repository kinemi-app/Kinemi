import { serveWeb } from "../../lib/web/static";

/** Every path no /api route claims is the frontend in web/dist. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return serveWeb(new URL(request.url), { accept: request.headers.get("accept-encoding") });
}

export function HEAD(request: Request) {
  return serveWeb(new URL(request.url), { head: true, accept: request.headers.get("accept-encoding") });
}
