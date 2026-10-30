import { NextResponse } from "next/server";
import { RemoteAssetError, importRemote } from "../../../../lib/generate/remote";

const STATUS_BY_REASON = {
  foreign: 400,
  unsupported: 415,
  upstream: 502,
} as const;

/**
 * POST /api/assets/from-url: copy one ComfyUI output into the deployment's input folder. The URL
 * must be a file on the configured ComfyUI origin; a browser cannot use this to proxy elsewhere.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const { url } = body as Record<string, unknown>;
  if (typeof url !== "string" || url.trim() === "") {
    return NextResponse.json({ error: `"url" must be a non-empty string` }, { status: 400 });
  }

  try {
    return NextResponse.json(await importRemote(url));
  } catch (cause) {
    if (cause instanceof RemoteAssetError) {
      return NextResponse.json(
        { error: cause.message },
        { status: STATUS_BY_REASON[cause.reason] },
      );
    }
    const message = cause instanceof Error ? cause.message : "the asset could not be imported";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
