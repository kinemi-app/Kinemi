import { NextResponse } from "next/server";
import { MAX_ASSET_BYTES, sniffAsset, storeAsset } from "../../../lib/generate/assets";

/** Room for multipart boundaries and headers on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_ASSET_MB = MAX_ASSET_BYTES / (1024 * 1024);

/**
 * POST /api/assets: one multipart file in field "file". The bytes decide the type, so a renamed
 * file is still refused. The answer names the file the way ComfyUI's input folder holds it.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: `the file is larger than ${MAX_ASSET_MB} MB` }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "body must be multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: `multipart field "file" is required` }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "the file is empty" }, { status: 400 });
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: `the file is larger than ${MAX_ASSET_MB} MB` }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffAsset(bytes);
  if (!type) {
    return NextResponse.json(
      { error: "only images, video and audio are accepted" },
      { status: 415 },
    );
  }

  try {
    const name = await storeAsset(bytes, type.contentType);
    return NextResponse.json({ name });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "the upload failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
