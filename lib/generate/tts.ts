import { spawnSync } from "node:child_process";

/**
 * Demo speech through a local command. `KINEMI_TTS_CMD` receives the text on stdin and must write
 * a WAV file to stdout; anything else (a missing command, a crash, a timeout, a non-WAV answer)
 * falls back to the synthesised tone, so a broken tool never fails an audio job.
 */

const TTS_TIMEOUT_MS = 15_000;
const MAX_TTS_BYTES = 10 * 1024 * 1024;
const WAV_MAGIC = "RIFF";
const WAVE_MAGIC = "WAVE";

export function ttsConfigured(): boolean {
  const command = process.env.KINEMI_TTS_CMD;
  return typeof command === "string" && command.trim() !== "";
}

function isWav(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === WAV_MAGIC &&
    bytes.toString("ascii", 8, 12) === WAVE_MAGIC
  );
}

/** A WAV data URL for the spoken text, or undefined when no command is configured or it failed. */
export function speak(text: string): string | undefined {
  const command = process.env.KINEMI_TTS_CMD;
  if (typeof command !== "string" || command.trim() === "") {
    return undefined;
  }

  try {
    const result = spawnSync(command, {
      shell: true,
      input: text,
      timeout: TTS_TIMEOUT_MS,
      maxBuffer: MAX_TTS_BYTES,
    });
    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
      return undefined;
    }
    if (!isWav(result.stdout)) {
      return undefined;
    }
    return `data:audio/wav;base64,${result.stdout.toString("base64")}`;
  } catch {
    // spawnSync reports failures in its result; a defensive catch keeps the demo path total.
    return undefined;
  }
}
