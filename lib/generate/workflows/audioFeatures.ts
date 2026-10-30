import type { GenerateRequest } from "../../types";
import { requireString, type WorkflowGraph } from "../pipeline";
import { VIDEO_HEIGHT, VIDEO_WIDTH, type GraphBuilder } from "./graph";

/**
 * What the Audio Studio's two graph modules share: the six panels, the model each one is pinned
 * to, the dub languages and the speaker seed. audio.ts builds them for a local ComfyUI,
 * audio-cloud.ts for Comfy Cloud; both read these from here so the targets can't drift apart.
 */

export const FEATURES = ["voiceover", "clone", "swap", "dub", "scene", "sfx"] as const;
export type AudioFeature = (typeof FEATURES)[number];

/** Each panel pins one model; a different modelId would bill a graph the run does not use. */
const FEATURE_MODEL: Record<AudioFeature, string> = {
  voiceover: "chatterbox",
  clone: "chatterbox",
  swap: "chatterbox",
  dub: "chatterbox",
  scene: "chatterbox",
  sfx: "audiogen-medium",
};

/** Mirror of the 18-language list in components/flows/audio/audioConfig.ts. */
const LANGUAGES = new Set([
  "en", "es", "fr", "de", "it", "pt", "nl", "pl", "tr", "ru",
  "ar", "hi", "ja", "ko", "zh", "yue", "vi", "id",
]);

export function audioOutput(builder: GraphBuilder): WorkflowGraph {
  return { nodes: builder.nodes, output: "audio", width: 0, height: 0 };
}

export function videoOutput(builder: GraphBuilder): WorkflowGraph {
  return { nodes: builder.nodes, output: "video", width: VIDEO_WIDTH, height: VIDEO_HEIGHT };
}

export function readFeature(request: GenerateRequest): AudioFeature {
  const feature = request.params?.feature;
  if (typeof feature !== "string" || !(FEATURES as readonly string[]).includes(feature)) {
    throw new Error(`the audio mode needs params.feature, one of ${FEATURES.join(", ")}`);
  }
  const pinned = FEATURE_MODEL[feature as AudioFeature];
  if (request.modelId !== pinned) {
    throw new Error(`the ${feature} feature runs on "${pinned}", not "${request.modelId}"`);
  }
  return feature as AudioFeature;
}

export function readLanguage(params: GenerateRequest["params"]): string {
  const language = requireString(params, "language", "dubbing needs a target language");
  if (!LANGUAGES.has(language)) {
    throw new Error(`dubbing does not support the target language "${language}"`);
  }
  return language;
}

/** A speaker keeps its voice settings across runs: the seed is the name's hash, not chance. */
export function speakerSeed(speaker: string): number {
  let hash = 2166136261;
  for (let index = 0; index < speaker.length; index += 1) {
    hash ^= speaker.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
