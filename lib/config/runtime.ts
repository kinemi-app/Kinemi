import { spawnSync } from "node:child_process";

import { models } from "../models";
import { llmSettings } from "./llm";

/**
 * Runtime configuration read at call time, never at module load: a test starts a fresh server with
 * its own environment, and a deployment may change an endpoint without a rebuild. Nothing here
 * returns a key; the status only says whether one is present.
 */

export type GenerationMode = "auto" | "cloud" | "local";

export type ComfySettings = { url: string; apiKey: string };

export type StatusSnapshot = {
  generation: "cloud" | "demo";
  mode: GenerationMode;
  comfy: { configured: boolean; origin: string; hasKey: boolean };
  llm: { configured: boolean; model: string };
  tools: { ffmpeg: boolean; tts: boolean };
  models: number;
};

const MODES: readonly GenerationMode[] = ["auto", "cloud", "local"];
const FFMPEG_PROBE_TIMEOUT_MS = 2_000;

function trimmed(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** An unknown or empty value is `auto`, so a typo never turns a deployment into demo by accident. */
export function generationMode(): GenerationMode {
  const value = trimmed("GENERATION_MODE").toLowerCase();
  return MODES.includes(value as GenerationMode) ? (value as GenerationMode) : "auto";
}

/** The configured ComfyUI endpoint, with trailing slashes removed, or undefined in demo mode. */
export function comfySettings(): ComfySettings | undefined {
  const url = trimmed("COMFY_URL");
  if (url === "") {
    return undefined;
  }
  return { url: withoutUserinfo(url.replace(/\/+$/, "")), apiKey: trimmed("COMFY_API_KEY") };
}

/**
 * Drop `user:pass@` from the endpoint. Left in, it would reach job result URLs and error messages;
 * the supported place for a credential is COMFY_API_KEY.
 */
function withoutUserinfo(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username === "" && parsed.password === "") {
      return url;
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return url;
  }
}

/** The endpoint without userinfo, path, query or fragment; `"invalid"` when it is not a URL. */
export function publicOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "invalid";
  }
}

/** The binary the export route would run; a configured path wins over PATH. */
function ffmpegAvailable(): boolean {
  const command = trimmed("KINEMI_FFMPEG_PATH") || "ffmpeg";
  try {
    return spawnSync(command, ["-version"], {
      stdio: "ignore",
      timeout: FFMPEG_PROBE_TIMEOUT_MS,
      windowsHide: true,
    }).status === 0;
  } catch {
    return false;
  }
}

export function statusSnapshot(): StatusSnapshot {
  const mode = generationMode();
  const comfy = comfySettings();
  const llm = llmSettings();

  return {
    generation: comfy !== undefined && mode !== "local" ? "cloud" : "demo",
    mode,
    comfy: {
      configured: comfy !== undefined,
      origin: comfy === undefined ? "" : publicOrigin(comfy.url),
      hasKey: comfy !== undefined && comfy.apiKey !== "",
    },
    llm: { configured: llm !== undefined, model: llm?.model ?? "" },
    tools: { ffmpeg: ffmpegAvailable(), tts: trimmed("KINEMI_TTS_CMD") !== "" },
    models: models.length,
  };
}
