/**
 * Send one file to POST /api/assets and return the name Comfy sees in its input folder. The
 * contract belongs to the generation spine: multipart `file` in, `{ name }` out. The core film
 * flows use this one; the ads, audio and upscale crews each grew their own copy inside their own
 * scope, and the copies merge once those crews have reported.
 */
export async function uploadAsset(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/assets", { method: "POST", body });
  if (!response.ok) {
    let detail = `upload failed: HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === "string") {
        detail = payload.error;
      }
    } catch {
      // Not JSON; keep the status line.
    }
    throw new Error(detail);
  }

  const payload = (await response.json()) as { name?: unknown };
  if (typeof payload.name !== "string" || payload.name.trim() === "") {
    throw new Error("the asset upload returned no name");
  }
  return payload.name;
}

/** The message to show when an upload fails; anything that is not an Error has no better detail. */
export function uploadErrorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The upload failed.";
}
