import { comfySettings, publicOrigin } from "../config/runtime";
import type { ModelKind } from "../types";
import { MAX_ASSET_BYTES, sniffAsset, storeAsset } from "./assets";
import { COMFY_VIEW_ROUTE, fetchComfyView, parseViewQuery, type ComfyViewQuery } from "./comfy";

/**
 * Canvas chaining reads an upstream result back out of the deployment. The URL must name one
 * output file, through this server's COMFY_VIEW_ROUTE or the deployment's own /view; the file is
 * read from the configured deployment with the server's key, sniffed like any upload and stored in
 * its input folder, so the next graph can load it by name. No arbitrary URL is proxied.
 */

const MAX_ASSET_MB = MAX_ASSET_BYTES / (1024 * 1024);
/** Resolves a relative result URL; only its path and query are read, never this origin. */
const RELATIVE_BASE = "http://relative.invalid";

export type RemoteAsset = { name: string; kind: ModelKind };

export class RemoteAssetError extends Error {
  readonly reason: "foreign" | "unsupported" | "upstream";

  constructor(message: string, reason: "foreign" | "unsupported" | "upstream") {
    super(message);
    this.name = "RemoteAssetError";
    this.reason = reason;
  }
}

/** Whether a URL shares the configured ComfyUI origin; a relative or malformed URL never does. */
export function isComfyUrl(url: string): boolean {
  const settings = comfySettings();
  if (settings === undefined) {
    return false;
  }
  try {
    return new URL(url).origin === new URL(settings.url).origin;
  } catch {
    return false;
  }
}

function declaredTooLarge(response: Response): boolean {
  const declared = Number(response.headers.get("content-length") ?? "");
  return Number.isFinite(declared) && declared > MAX_ASSET_BYTES;
}

/**
 * The output file a result URL names: this server's view route (relative or absolute, whatever its
 * host, since only the query is used) or /view on the deployment itself. Anything else is undefined.
 */
function viewQueryFor(url: string): ComfyViewQuery | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url, RELATIVE_BASE);
  } catch {
    return undefined;
  }
  const isViewRoute = parsed.pathname === COMFY_VIEW_ROUTE;
  // COMFY_URL may carry a path prefix, so the deployment's own /view is matched by its last part.
  const isDeploymentView = parsed.pathname.endsWith("/view") && isComfyUrl(url);
  return isViewRoute || isDeploymentView ? parseViewQuery(parsed.searchParams) : undefined;
}

/** Fetch one ComfyUI output and store it under a name the next graph can load. */
export async function importRemote(url: string): Promise<RemoteAsset> {
  const settings = comfySettings();
  const query = viewQueryFor(url);
  if (settings === undefined || query === undefined) {
    throw new RemoteAssetError("the URL does not name an output on the configured ComfyUI origin", "foreign");
  }

  let response: Response;
  try {
    response = await fetchComfyView(settings, query, null);
  } catch {
    throw new RemoteAssetError(
      `Comfy could not be read at ${publicOrigin(settings.url)} for the upstream result`,
      "upstream",
    );
  }

  if (!response.ok) {
    throw new RemoteAssetError(
      `Comfy refused the upstream result: HTTP ${response.status}`,
      "upstream",
    );
  }
  if (declaredTooLarge(response)) {
    throw new RemoteAssetError(`the upstream result is larger than ${MAX_ASSET_MB} MB`, "upstream");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new RemoteAssetError(`the upstream result is larger than ${MAX_ASSET_MB} MB`, "upstream");
  }

  const type = sniffAsset(bytes);
  if (type === undefined) {
    throw new RemoteAssetError(
      "the upstream result is not an image, video or audio file",
      "unsupported",
    );
  }

  try {
    const name = await storeAsset(bytes, type.contentType);
    return { name, kind: type.kind };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "the upstream result could not be stored";
    throw new RemoteAssetError(message, "upstream");
  }
}
