import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { sniffAsset, storeAsset } from "../../../lib/generate/assets";

/**
 * POST /api/import-image: fetch one product photo from an http(s) URL and keep it in the same
 * asset store as POST /api/assets. The server does the fetching, so the URL is checked before
 * every hop: only public hosts, at most 3 redirects, a 10 s deadline, and a 10 MB image cap.
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);
/** A URL in JSON is small; anything larger is not this route's request. */
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

class ImportProblem extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    // A form we do not understand is treated as unsafe.
    return true;
  }
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") {
    return true;
  }
  if (lower.startsWith("fe80:") || lower.startsWith("fec0:") || lower.startsWith("ff")) {
    return true;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) {
    return true;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  return mapped !== null && isPrivateIPv4(mapped[1] ?? "");
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return !isPrivateIPv4(address);
  }
  if (version === 6) {
    return !isPrivateIPv6(address);
  }
  return false;
}

/** Refuse a host before connecting: a literal IP or every address its name resolves to. */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    if (!isPublicAddress(host)) {
      throw new ImportProblem(`${host} is not a public host`, 403);
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ImportProblem(`could not resolve ${host}`, 502);
  }
  if (addresses.length === 0) {
    throw new ImportProblem(`could not resolve ${host}`, 502);
  }
  const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
  if (blocked) {
    throw new ImportProblem(`${host} resolves to the private address ${blocked.address}`, 403);
  }
}

function nextUrl(location: string, base: URL): URL {
  let next: URL;
  try {
    next = new URL(location, base);
  } catch {
    throw new ImportProblem("the site answered a redirect with an invalid location", 502);
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") {
    throw new ImportProblem("redirects must stay on http or https", 403);
  }
  return next;
}

/** Follow up to MAX_REDIRECTS by hand so every hop gets the host check. */
async function fetchImage(start: URL): Promise<Response> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let target = start;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicHost(target.hostname);

    let response: Response;
    try {
      response = await fetch(target, { redirect: "manual", signal });
    } catch (cause) {
      if (signal.aborted) {
        throw new ImportProblem(`fetching ${target.hostname} took longer than 10 s`, 504);
      }
      const detail = cause instanceof Error ? cause.message : "the request failed";
      throw new ImportProblem(`could not fetch ${target.hostname}: ${detail}`, 502);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new ImportProblem("the site answered a redirect without a location", 502);
      }
      if (redirects === MAX_REDIRECTS) {
        throw new ImportProblem(`the URL redirects more than ${MAX_REDIRECTS} times`, 502);
      }
      target = nextUrl(location, target);
      continue;
    }

    if (!response.ok) {
      throw new ImportProblem(`the site answered HTTP ${response.status}`, 502);
    }
    return response;
  }

  throw new ImportProblem(`the URL redirects more than ${MAX_REDIRECTS} times`, 502);
}

/** Read at most MAX_IMAGE_BYTES, whether or not the site declared a length. */
async function readImageBody(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    throw new ImportProblem(`the image is larger than ${MAX_IMAGE_MB} MB`, 413);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ImportProblem("the site answered without a body", 502);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new ImportProblem(`the image is larger than ${MAX_IMAGE_MB} MB`, 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function readUrl(body: unknown): URL {
  if (typeof body !== "object" || body === null) {
    throw new ImportProblem("body must be a JSON object", 400);
  }
  const raw = (body as Record<string, unknown>).url;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ImportProblem(`"url" must be a non-empty string`, 400);
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportProblem("the URL is not a valid address", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportProblem("only http and https URLs are accepted", 400);
  }
  return url;
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "the request body is too large" }, { status: 413 });
  }

  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "the request body is too large" }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }

    const url = readUrl(body);
    const response = await fetchImage(url);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (!contentType?.startsWith("image/")) {
      await response.body?.cancel();
      throw new ImportProblem(`the URL serves ${contentType || "no content type"}, not an image`, 415);
    }

    const bytes = await readImageBody(response);
    const type = sniffAsset(bytes);
    if (!type || type.kind !== "image") {
      throw new ImportProblem("the URL does not serve an image file", 415);
    }

    const name = await storeAsset(bytes, type.contentType);
    return NextResponse.json({ name });
  } catch (cause) {
    if (cause instanceof ImportProblem) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    const message = cause instanceof Error ? cause.message : "the import failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
