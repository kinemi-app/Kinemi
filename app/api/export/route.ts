import { NextResponse } from "next/server";
import { MAX_ASSET_BYTES, sniffAsset } from "../../../lib/generate/assets";
import { ConversionError, convertWebmToMp4 } from "./ffmpeg";
import type { ConversionFailure } from "./ffmpeg";

/**
 * POST /api/export: one multipart WebM clip in field "file"; the answer is that clip as MP4, muxed
 * by the host's ffmpeg. The route is additive: the previz panel keeps its WebM download whenever
 * this route fails, including the 501 a host without ffmpeg answers.
 */

/** Room for multipart boundaries and headers on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_CLIP_MB = MAX_ASSET_BYTES / (1024 * 1024);
const WEBM_CONTENT_TYPE = "video/webm";
const MP4_CONTENT_TYPE = "video/mp4";
const DOWNLOAD_NAME = "kinemi-previz.mp4";

const FAILURES: Record<ConversionFailure, { status: number; message: string }> = {
  unavailable: {
    status: 501,
    message: "MP4 export needs ffmpeg, which is not installed on this server",
  },
  timeout: {
    status: 504,
    message: "the MP4 conversion took too long; try a shorter clip",
  },
  rejected: {
    status: 422,
    message: "ffmpeg could not convert the uploaded clip",
  },
  failed: {
    status: 500,
    message: "the MP4 conversion failed",
  },
};

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: `the file is larger than ${MAX_CLIP_MB} MB` }, { status: 413 });
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
    return NextResponse.json({ error: `the file is larger than ${MAX_CLIP_MB} MB` }, { status: 413 });
  }

  const clip = new Uint8Array(await file.arrayBuffer());
  const type = sniffAsset(clip);
  if (type?.contentType !== WEBM_CONTENT_TYPE) {
    return NextResponse.json({ error: "only WebM clips are accepted" }, { status: 415 });
  }

  try {
    const mp4 = await convertWebmToMp4(clip);
    // readFile returns a Buffer, typed as a Uint8Array over ArrayBufferLike; NextResponse's body
    // type wants an ArrayBuffer-backed view, so copy the bytes once before answering.
    const body = new Uint8Array(mp4);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": MP4_CONTENT_TYPE,
        "content-disposition": `attachment; filename="${DOWNLOAD_NAME}"`,
      },
    });
  } catch (cause) {
    const failure = cause instanceof ConversionError ? FAILURES[cause.failure] : FAILURES.failed;
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
