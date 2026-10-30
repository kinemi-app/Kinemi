import { findModel, models } from "../models";
import type { GenerateParams, GenerateRequest, Mode } from "../types";
import { graphTargetFromEnv } from "./comfy";
import { graphFor } from "./workflows";

/**
 * What a deployment needs. One sample request per graph the registry advertises goes through the
 * same builder a real run uses, so the check lists exactly the nodes and files this build would
 * ask for. A graph that refuses its sample is an error row, never a thrown failure that hides the
 * others.
 */

const SAMPLE_PROMPT = "kinemi deployment check";
const SAMPLE_DURATION_S = 1;
const CHECK_IMAGE = "kinemi-check.png";
const CHECK_VIDEO = "kinemi-check.mp4";
const CHECK_AUDIO = "kinemi-check.wav";
const FILE_PATTERN = /\.(safetensors|ckpt|pth|pt|bin|gguf)$/i;

export type RequirementRow = {
  mode: Mode;
  modelId: string;
  feature?: string;
  variant?: string;
  nodes: string[];
  files: string[];
  error?: string;
};

/** One advertised feature the mode splits into; its graph pins it to a single model. */
type FeatureSample = {
  mode: Mode;
  modelId: string;
  feature: string;
  extra?: GenerateParams;
  /** Names a second sample of the same feature, such as the AudioMatch path. */
  variant?: string;
};

/**
 * The modes that split into features, each sampled on the model its graph pins it to. One sample
 * per model+mode would pass a deployment that lacks the dubbing or voice-swap nodes, because the
 * audio mode's six graphs share one model row.
 */
const FEATURE_SAMPLES: readonly FeatureSample[] = [
  { mode: "audio", modelId: "chatterbox", feature: "voiceover" },
  {
    mode: "audio",
    modelId: "chatterbox",
    feature: "clone",
    extra: { audioName: CHECK_AUDIO, consent: true },
  },
  {
    mode: "audio",
    modelId: "chatterbox",
    feature: "swap",
    extra: { videoName: CHECK_VIDEO, audioName: CHECK_AUDIO },
  },
  {
    mode: "audio",
    modelId: "chatterbox",
    feature: "dub",
    extra: { videoName: CHECK_VIDEO, language: "es" },
  },
  { mode: "audio", modelId: "chatterbox", feature: "scene", extra: { speaker: "Narrator" } },
  { mode: "audio", modelId: "audiogen-medium", feature: "sfx" },
  {
    mode: "audio",
    modelId: "audiogen-medium",
    feature: "sfx",
    extra: { audioName: CHECK_AUDIO },
    variant: "match",
  },
  { mode: "ads", modelId: "flux-2-dev", feature: "product", extra: { imageName: CHECK_IMAGE } },
  { mode: "ads", modelId: "flux-2-dev", feature: "hooks" },
  {
    mode: "ads",
    modelId: "flux-2-dev",
    feature: "posters",
    extra: { imageName: CHECK_IMAGE },
  },
  { mode: "ads", modelId: "wan22-i2v", feature: "ugc", extra: { imageName: CHECK_IMAGE } },
  { mode: "ads", modelId: "wan22-i2v", feature: "unboxing", extra: { imageName: CHECK_IMAGE } },
  { mode: "ads", modelId: "wan22-i2v", feature: "tutorial", extra: { imageName: CHECK_IMAGE } },
  {
    mode: "fashion",
    modelId: "flux-2-dev",
    feature: "swap",
    extra: { imageName: CHECK_IMAGE, endImageName: CHECK_IMAGE },
  },
  { mode: "fashion", modelId: "flux-2-dev", feature: "match" },
  { mode: "fashion", modelId: "flux-2-dev", feature: "campaign" },
];

/** The parameters a mode that does not split into features needs, with placeholder assets. */
function modeParams(mode: Mode, modelId: string): GenerateParams {
  switch (mode) {
    case "reshoot":
      return { imageName: CHECK_IMAGE };
    case "edit":
    case "genjutsu":
      return { videoName: CHECK_VIDEO };
    case "ads": {
      const model = findModel(modelId);
      return model?.kind === "video"
        ? { feature: "ugc", imageName: CHECK_IMAGE }
        : { feature: "product", imageName: CHECK_IMAGE };
    }
    case "depth":
      return { imageName: CHECK_IMAGE };
    case "upscale":
      return {
        videoName: CHECK_VIDEO,
        factor: 2,
        fps: 30,
        deflicker: 0,
        sourceDurationS: 1,
      };
    default:
      return {};
  }
}

/** A request the graph accepts for this model+mode (or this feature), with placeholder assets. */
export function sampleRequest(
  mode: Mode,
  modelId: string,
  sample?: FeatureSample,
): GenerateRequest {
  const params =
    sample === undefined
      ? modeParams(mode, modelId)
      : { feature: sample.feature, ...sample.extra };

  return {
    mode,
    modelId,
    prompt: SAMPLE_PROMPT,
    durationS: SAMPLE_DURATION_S,
    params,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** The nodes and files one sample graph asks a deployment for. */
function rowFor(mode: Mode, modelId: string, sample?: FeatureSample): RequirementRow {
  const label: RequirementRow = {
    mode,
    modelId,
    nodes: [],
    files: [],
    ...(sample?.feature === undefined ? {} : { feature: sample.feature }),
    ...(sample?.variant === undefined ? {} : { variant: sample.variant }),
  };

  try {
    const graph = graphFor(sampleRequest(mode, modelId, sample), graphTargetFromEnv());
    const nodes: string[] = [];
    const files: string[] = [];
    for (const node of Object.values(graph.nodes)) {
      nodes.push(node.class_type);
      for (const value of Object.values(node.inputs)) {
        if (typeof value === "string" && FILE_PATTERN.test(value)) {
          files.push(value);
        }
      }
    }
    return { ...label, nodes: unique(nodes), files: unique(files) };
  } catch (cause) {
    return {
      ...label,
      error: cause instanceof Error ? cause.message : "the sample graph could not be built",
    };
  }
}

/**
 * One row per graph the registry advertises: every model+mode pair in a mode that does not split,
 * and every feature sample in the modes that do.
 */
export function requirements(): RequirementRow[] {
  const featureModes = new Set(FEATURE_SAMPLES.map((sample) => sample.mode));

  const pairs = models.flatMap((model) =>
    model.modes
      .filter((mode) => !featureModes.has(mode))
      .map((mode) => rowFor(mode, model.id)),
  );
  const features = FEATURE_SAMPLES.map((sample) => rowFor(sample.mode, sample.modelId, sample));

  return [...pairs, ...features];
}
