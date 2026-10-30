import { NextResponse } from "next/server";
import { publicOrigin } from "../../../../lib/config/runtime";
import { comfyConfigFromEnv, fetchComfyView, parseViewQuery } from "../../../../lib/generate/comfy";

/** The /view headers a browser needs to play, seek and cache the file; nothing else is relayed. */
const RELAYED_HEADERS = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"];
/** Only media is served as itself: anything else on this origin could run as a page. */
const MEDIA_TYPE = /^(image|video|audio)\//i;

/** The relayed headers, with a non-media type downgraded to a download. */
function relayedHeaders(upstream: Response): Headers {
  const headers = new Headers({ "x-content-type-options": "nosniff" });
  const type = upstream.headers.get("content-type") ?? "";
  headers.set("content-type", MEDIA_TYPE.test(type) ? type : "application/octet-stream");
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * GET /api/comfy/view?filename=&subfolder=&type=: one finished run's file, fetched from the
 * configured deployment's /view with the server's key and streamed back. Not an open proxy: the
 * host is always COMFY_URL and only a parsed output file is asked for.
 */
export async function GET(request: Request) {
  const config = comfyConfigFromEnv();
  if (!config) {
    return NextResponse.json({ error: "no ComfyUI deployment is configured" }, { status: 404 });
  }

  const query = parseViewQuery(new URL(request.url).searchParams);
  if (!query) {
    return NextResponse.json(
      { error: "filename, subfolder and type must name one output file of a run" },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetchComfyView(config, query, request.headers.get("range"));
  } catch {
    return NextResponse.json(
      { error: `Comfy could not be reached at ${publicOrigin(config.url)} for the result` },
      { status: 502 },
    );
  }

  if (!upstream.ok || upstream.body === null) {
    await upstream.body?.cancel();
    const status = upstream.status === 404 ? 404 : 502;
    return NextResponse.json({ error: `Comfy refused the result: HTTP ${upstream.status}` }, { status });
  }

  return new Response(upstream.body, { status: upstream.status, headers: relayedHeaders(upstream) });
}
