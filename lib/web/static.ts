import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/**
 * The frontend is the Astro build in web/dist (landing, studio, account and legal pages). Next
 * serves it through one catch-all route; every /api route is more specific and wins.
 */
export const WEB_DIST = path.join(process.cwd(), "web", "dist");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".glb": "model/gltf-binary",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/** Types worth packing: text shrinks a lot, images, fonts and media are already compressed. */
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".txt", ".xml", ".svg"]);

/** Below this the encoding headers cost more than they save. */
const MIN_COMPRESSIBLE_BYTES = 1024;

const HASHED = "public, max-age=31536000, immutable";
const PAGE = "no-cache";
const OTHER = "public, max-age=3600";

type Encoding = "br" | "gzip";

/** The codings the client accepts: a q=0 entry means "not this one". */
function accepted(accept: string | null | undefined): Set<string> {
  const codings = new Set<string>();
  for (const entry of (accept ?? "").toLowerCase().split(",")) {
    const [name, ...params] = entry.split(";").map((part) => part.trim());
    const q = params.find((param) => param.startsWith("q="));
    if (name && Number(q?.slice(2) ?? 1) > 0) {
      codings.add(name);
    }
  }
  return codings;
}

/** The best encoding the client and the file agree on, or null to send the bytes as they are. */
function encodingFor(accept: string | null | undefined, file: string, size: number): Encoding | null {
  if (size < MIN_COMPRESSIBLE_BYTES || !COMPRESSIBLE.has(path.extname(file).toLowerCase())) {
    return null;
  }
  const codings = accepted(accept);
  if (codings.has("br")) {
    return "br";
  }
  return codings.has("gzip") ? "gzip" : null;
}

/** The bytes for the wire: brotli when the client offers it, gzip next, plain last. */
function packed(raw: Buffer, encoding: Encoding | null): Buffer {
  if (encoding === "br") {
    return brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
  }
  return encoding === "gzip" ? gzipSync(raw) : raw;
}

/** The file a URL path names inside root, or null when it would leave root or is malformed. */
export function resolveInside(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) {
    return null;
  }
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

async function kindOf(file: string): Promise<"file" | "dir" | null> {
  try {
    const info = await stat(file);
    return info.isDirectory() ? "dir" : info.isFile() ? "file" : null;
  } catch {
    return null;
  }
}

function cacheFor(pathname: string, file: string) {
  if (pathname.startsWith("/_astro/")) {
    return HASHED;
  }
  return file.endsWith(".html") ? PAGE : OTHER;
}

async function fileResponse(file: string, status: number, cache: string, head: boolean, accept?: string | null) {
  const raw = await readFile(file);
  const encoding = encodingFor(accept, file, raw.byteLength);
  const bytes = packed(raw, encoding);
  const headers: Record<string, string> = {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": String(bytes.byteLength),
    "cache-control": cache,
    "x-content-type-options": "nosniff",
    // the same URL answers packed or plain depending on the client: caches must keep them apart
    vary: "accept-encoding",
  };
  if (encoding) {
    headers["content-encoding"] = encoding;
  }
  // Buffer is a Uint8Array; a plain view is what Response takes
  return new Response(head ? null : new Uint8Array(bytes), { status, headers });
}

async function notFound(root: string, head: boolean, accept?: string | null) {
  const page = path.join(root, "404.html");
  if ((await kindOf(page)) === "file") {
    return fileResponse(page, 404, PAGE, head, accept);
  }
  return new Response(head ? null : "Not found", { status: 404 });
}

/** Answer one GET or HEAD for the frontend: a file, a folder's index.html, a redirect or the 404 page. */
export async function serveWeb(
  url: URL,
  { head = false, root = WEB_DIST, accept = null }: { head?: boolean; root?: string; accept?: string | null } = {},
): Promise<Response> {
  if ((await kindOf(root)) !== "dir") {
    return new Response("The frontend is not built: run `npm run build`.", { status: 503 });
  }

  const file = resolveInside(root, url.pathname);
  if (!file) {
    return notFound(root, head, accept);
  }

  const kind = await kindOf(file);
  if (kind === "dir") {
    if (!url.pathname.endsWith("/")) {
      return new Response(null, { status: 308, headers: { location: `${url.pathname}/${url.search}` } });
    }
    const index = path.join(file, "index.html");
    return (await kindOf(index)) === "file" ? fileResponse(index, 200, PAGE, head, accept) : notFound(root, head, accept);
  }
  if (kind === "file") {
    return fileResponse(file, 200, cacheFor(url.pathname, file), head, accept);
  }
  return notFound(root, head, accept);
}
