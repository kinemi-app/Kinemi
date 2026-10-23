/**
 * Send one file to POST /api/assets and return the name Comfy sees in its input folder. The
 * contract belongs to the generation spine; this module only does what both audio panels need.
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
