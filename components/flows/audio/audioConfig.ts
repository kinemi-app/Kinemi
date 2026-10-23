import type { SegmentOption } from "../../ui";

export type AudioFeature = "voiceover" | "clone" | "swap" | "dub" | "scene" | "sfx";

export const AUDIO_MODEL: Record<AudioFeature, string> = {
  voiceover: "kokoro-tts",
  clone: "chatterbox",
  swap: "chatterbox",
  dub: "chatterbox",
  scene: "chatterbox",
  sfx: "audiogen-medium",
};

export const VOICES: SegmentOption[] = [
  { value: "warm", label: "Warm" },
  { value: "clear", label: "Clear" },
  { value: "bright", label: "Bright" },
  { value: "deep", label: "Deep" },
];

export const LANGUAGES: SegmentOption[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "tr", label: "Turkish" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Mandarin Chinese" },
  { value: "yue", label: "Cantonese" },
  { value: "vi", label: "Vietnamese" },
  { value: "id", label: "Indonesian" },
];

export const SPEAKERS: SegmentOption[] = [
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
];

export const AMBIENCE: SegmentOption[] = [
  { value: "room", label: "Room" },
  { value: "street", label: "Street" },
  { value: "rain", label: "Rain" },
  { value: "none", label: "None" },
];

export const MIN_LENGTH_S = 1;
export const MAX_LENGTH_S = 30;
export const DEFAULT_LENGTH_S = 3;
export const DEFAULT_VOICE = "warm";
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2;
export const DEFAULT_SPEED = 1;
export const DEFAULT_LANGUAGE = "en";
export const DEFAULT_SPEAKERS = "2";
export const DEFAULT_AMBIENCE = "room";
export const WAIT_TITLE = "Wait for the current run to finish";
export const EMPTY_TITLE = "Nothing rendered yet";
export const EMPTY_BODY =
  "Pick a job, fill in its fields, then run. Without a Comfy deployment every run returns a demo tone, not a voice.";

const SCENE_LINE = /^([^:]+):\s*(\S.*)$/;

export type SceneLine = { speaker: string; text: string };

/** Every non-empty line must be "Name: line"; an empty script is not a scene. */
export function parseScene(script: string): SceneLine[] | undefined {
  const lines = script
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) {
    return undefined;
  }

  const parsed: SceneLine[] = [];
  for (const line of lines) {
    const match = SCENE_LINE.exec(line);
    const speaker = match?.[1]?.trim() ?? "";
    const text = match?.[2]?.trim() ?? "";
    if (speaker === "" || text === "") {
      return undefined;
    }
    parsed.push({ speaker, text });
  }
  return parsed;
}

export function sceneIsValid(script: string): boolean {
  return parseScene(script) !== undefined;
}

export function optionLabel(options: SegmentOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** A button with no run says why it is disabled; a ready one waits while any run is active. */
export function buttonTitle(ready: boolean, missing: string, busy: boolean): string | undefined {
  if (!ready) return missing;
  return busy ? WAIT_TITLE : undefined;
}
