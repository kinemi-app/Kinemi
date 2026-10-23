/**
 * POST /api/export from the previz panel: MediaRecorder can only record WebM here, so the server
 * converts the clip to MP4 with ffmpeg. A failed conversion is not fatal for the panel, which
 * downloads the WebM recording instead.
 */

const EXPORT_PATH = "/api/export";
const EXPORT_TIMEOUT_MS = 90_000;
const CLIP_FILE_NAME = "kinemi-previz.webm";

/** The route writes its reason as JSON; fall back to the status when it answers with anything else. */
async function readError(response: Response): Promise<string> {
  const fallback = `MP4 export failed with HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error !== "" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function convertWebmToMp4(clip: Blob): Promise<Blob> {
  const form = new FormData();
  form.append("file", clip, CLIP_FILE_NAME);

  let response: Response;
  try {
    response = await fetch(EXPORT_PATH, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error("the export server could not be reached", { cause });
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.blob();
}
