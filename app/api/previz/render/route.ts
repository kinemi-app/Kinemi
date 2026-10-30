import { NextResponse } from "next/server";
import { comfySettings, generationMode } from "../../../../lib/config/runtime";
import { MAX_ASSET_BYTES, sniffAsset, storeAsset } from "../../../../lib/generate/assets";
import { comfyGeneratorFromEnv } from "../../../../lib/generate/comfy";

const MAX_PROMPT = 2000;
const MIN_DURATION_S = 1;
const MAX_DURATION_S = 5;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_ASSET_MB = MAX_ASSET_BYTES / (1024 * 1024);
const NEEDS_COMFY = "previz cloud render needs COMFY_URL; the local export still works";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

function readDuration(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_DURATION_S || value > MAX_DURATION_S) {
    return undefined;
  }
  return value;
}

/**
 * POST /api/previz/render: one captured frame plus a prompt becomes a short cinematic run on the
 * Comfy deployment. Without an endpoint the local export still works, so this answers 501 instead
 * of pretending a cloud render happened.
 */
export async function POST(request: Request) {
  if (comfySettings() === undefined || generationMode() === "local") {
    return NextResponse.json({ error: NEEDS_COMFY }, { status: 501 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: `the frame is larger than ${MAX_ASSET_MB} MB` }, { status: 413 });
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
    return NextResponse.json({ error: "the frame is empty" }, { status: 400 });
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: `the frame is larger than ${MAX_ASSET_MB} MB` }, { status: 413 });
  }

  const prompt = form.get("prompt");
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json({ error: `"prompt" must be a non-empty string` }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `"prompt" must be at most ${MAX_PROMPT} characters` }, { status: 400 });
  }

  const durationS = readDuration(form.get("durationS"));
  if (durationS === undefined) {
    return NextResponse.json(
      { error: `"durationS" must be a number from ${MIN_DURATION_S} to ${MAX_DURATION_S}` },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffAsset(bytes);
  if (type === undefined || !IMAGE_TYPES.has(type.contentType)) {
    return NextResponse.json({ error: "the frame must be a PNG or JPEG image" }, { status: 415 });
  }

  let imageName: string;
  try {
    imageName = await storeAsset(bytes, type.contentType);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "the frame could not be stored";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const generator = comfyGeneratorFromEnv();
  if (generator === undefined) {
    return NextResponse.json({ error: NEEDS_COMFY }, { status: 501 });
  }

  try {
    const job = await generator.submit({
      mode: "cinematic",
      modelId: "wan22-i2v",
      prompt,
      durationS,
      params: { imageName, source: "previz" },
    });
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "the render could not start";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
