import { publicOrigin } from "../config/runtime";
import { comfyAuthHeaders, comfyConfigFromEnv } from "./comfy";

/**
 * Asset intake for the Comfy adapter. The route sniffs the bytes, then this module forwards the
 * file to the deployment's upload endpoint so a graph can load it by name. With no COMFY_URL the
 * app is in demo mode: nothing is stored and every graph reads the name "demo".
 */

/** The fixed contract: one file, at most 50 MB. */
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;

const UPLOAD_TIMEOUT_MS = 60_000;

/** ComfyUI's upload endpoint stores a file under the name it answers with. */
const UPLOAD_PATH = "/upload/image";

export type AssetType = {
  kind: "image" | "video" | "audio";
  contentType: string;
};

const CONTENT_TYPES: Record<string, AssetType> = {
  png: { kind: "image", contentType: "image/png" },
  jpg: { kind: "image", contentType: "image/jpeg" },
  webp: { kind: "image", contentType: "image/webp" },
  gif: { kind: "image", contentType: "image/gif" },
  webm: { kind: "video", contentType: "video/webm" },
  mp4: { kind: "video", contentType: "video/mp4" },
  mov: { kind: "video", contentType: "video/quicktime" },
  avi: { kind: "video", contentType: "video/x-msvideo" },
  wav: { kind: "audio", contentType: "audio/wav" },
  mp3: { kind: "audio", contentType: "audio/mpeg" },
  ogg: { kind: "audio", contentType: "audio/ogg" },
  flac: { kind: "audio", contentType: "audio/flac" },
};

/** One extension per accepted content type, so the uploaded file keeps a usable suffix. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

function matches(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? -1;
}

/**
 * Identify a file from its first bytes, never from the browser's declared type. Returns undefined
 * for anything that is not an image, video or audio file, which the route answers with 415.
 */
export function sniffAsset(bytes: Uint8Array): AssetType | undefined {
  // RIFF containers carry the real type at byte 8.
  if (matches(bytes, 0, "RIFF")) {
    if (matches(bytes, 8, "WEBP")) return CONTENT_TYPES.webp;
    if (matches(bytes, 8, "WAVE")) return CONTENT_TYPES.wav;
    if (matches(bytes, 8, "AVI ")) return CONTENT_TYPES.avi;
    return undefined;
  }
  if (byteAt(bytes, 0) === 0x89 && matches(bytes, 1, "PNG")) return CONTENT_TYPES.png;
  if (byteAt(bytes, 0) === 0xff && byteAt(bytes, 1) === 0xd8 && byteAt(bytes, 2) === 0xff) {
    return CONTENT_TYPES.jpg;
  }
  if (matches(bytes, 0, "GIF87a") || matches(bytes, 0, "GIF89a")) return CONTENT_TYPES.gif;
  if (byteAt(bytes, 0) === 0x1a && byteAt(bytes, 1) === 0x45 && byteAt(bytes, 2) === 0xdf) {
    return CONTENT_TYPES.webm;
  }
  if (matches(bytes, 4, "ftyp")) return CONTENT_TYPES.mp4;
  if (matches(bytes, 0, "ID3")) return CONTENT_TYPES.mp3;
  if (byteAt(bytes, 0) === 0xff && (byteAt(bytes, 1) ?? 0) >= 0xe0) return CONTENT_TYPES.mp3;
  if (matches(bytes, 0, "OggS")) return CONTENT_TYPES.ogg;
  if (matches(bytes, 0, "fLaC")) return CONTENT_TYPES.flac;
  return undefined;
}

/**
 * Send one file to the deployment's input folder and return the name a graph loads. The name is
 * the one ComfyUI answered with, not the browser's file name. Demo mode returns "demo".
 */
export async function storeAsset(bytes: Uint8Array, contentType: string): Promise<string> {
  const config = comfyConfigFromEnv();
  if (!config) {
    return "demo";
  }

  const extension = EXTENSIONS[contentType];
  if (!extension) {
    throw new Error(`unsupported asset type "${contentType}"`);
  }

  const form = new FormData();
  const fileName = `kinemi-${crypto.randomUUID()}.${extension}`;
  // Copy into a plain ArrayBuffer: a view over a SharedArrayBuffer is not a BlobPart.
  const payload = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(payload).set(bytes);
  form.append("image", new Blob([payload], { type: contentType }), fileName);
  form.append("type", "input");

  // A keyed deployment refuses an upload without the key; fetch sets the multipart type.
  let response: Response;
  try {
    response = await fetch(`${config.url}${UPLOAD_PATH}`, {
      method: "POST",
      headers: comfyAuthHeaders(config),
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(`Comfy could not be reached at ${publicOrigin(config.url)} for the upload`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new Error(`Comfy refused the upload: HTTP ${response.status}`);
  }

  let body: { name?: unknown; subfolder?: unknown };
  try {
    body = (await response.json()) as { name?: unknown; subfolder?: unknown };
  } catch {
    throw new Error("Comfy's upload answered without JSON");
  }
  if (typeof body.name !== "string" || body.name === "") {
    throw new Error("Comfy's upload answered without a name");
  }

  return typeof body.subfolder === "string" && body.subfolder !== ""
    ? `${body.subfolder}/${body.name}`
    : body.name;
}
