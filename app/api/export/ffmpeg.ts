import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * MP4 conversion for POST /api/export. MediaRecorder writes WebM in every browser, so the server
 * re-encodes that clip to H.264/AAC in an MP4 container. The binary is the host's `ffmpeg` unless
 * KINEMI_FFMPEG_PATH names another one, which is also how the backend test reaches both branches.
 */

const execFileAsync = promisify(execFile);

const FFMPEG_ENV = "KINEMI_FFMPEG_PATH";
const DEFAULT_FFMPEG = "ffmpeg";
const CONVERT_TIMEOUT_MS = 60_000;
const MAX_STDERR_BYTES = 1024 * 1024;
const INPUT_FILE = "clip.webm";
const OUTPUT_FILE = "clip.mp4";
const TEMP_PREFIX = "kinemi-export-";
const X264_PRESET = "veryfast";
const X264_CRF = 23;
const AAC_BITRATE = "128k";
const MILLISECONDS_PER_SECOND = 1000;

export type ConversionFailure = "unavailable" | "timeout" | "rejected" | "failed";

/** A conversion problem with a reason the route maps to its own status. */
export class ConversionError extends Error {
  readonly failure: ConversionFailure;

  constructor(failure: ConversionFailure, message: string, cause?: unknown) {
    super(message, { cause });
    this.failure = failure;
  }
}

function resolveFfmpeg(): string {
  const configured = process.env[FFMPEG_ENV]?.trim();
  return configured ? configured : DEFAULT_FFMPEG;
}

/** H.264 is the codec every MP4 player reads; the audio map is a no-op for silent recordings. */
function conversionArgs(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-c:v",
    "libx264",
    "-preset",
    X264_PRESET,
    "-crf",
    String(X264_CRF),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    AAC_BITRATE,
    "-movflags",
    "+faststart",
    output,
  ];
}

function errorCode(cause: unknown): string | number | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return undefined;
  }
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function wasKilled(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "killed" in cause &&
    (cause as { killed?: unknown }).killed === true
  );
}

/**
 * One WebM clip in, the same clip as MP4 out, through two temp files that are removed either way.
 * Throws ConversionError so the route can tell a missing binary from a clip ffmpeg cannot read.
 */
export async function convertWebmToMp4(clip: Uint8Array): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const input = join(directory, INPUT_FILE);
  const output = join(directory, OUTPUT_FILE);

  try {
    await writeFile(input, clip);

    try {
      await execFileAsync(resolveFfmpeg(), conversionArgs(input, output), {
        timeout: CONVERT_TIMEOUT_MS,
        maxBuffer: MAX_STDERR_BYTES,
      });
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") {
        throw new ConversionError("unavailable", "ffmpeg is not installed on this server", cause);
      }
      if (wasKilled(cause)) {
        throw new ConversionError(
          "timeout",
          `ffmpeg did not finish within ${CONVERT_TIMEOUT_MS / MILLISECONDS_PER_SECOND} seconds`,
          cause,
        );
      }
      if (typeof errorCode(cause) === "number") {
        throw new ConversionError("rejected", "ffmpeg could not read or convert the clip", cause);
      }
      throw new ConversionError("failed", "ffmpeg could not run", cause);
    }

    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
