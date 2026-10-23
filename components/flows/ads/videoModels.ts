import { defaultModelForMode, modelsForMode } from "../../../lib/models";
import type { Model } from "../../../lib/types";
import { VIDEO_DURATION_S } from "./adsConfig";

function isVideoModel(model: Model): boolean {
  return model.kind === "video";
}

function isImageModel(model: Model): boolean {
  return model.kind === "image";
}

/** Video-capable models the ads mode can pick, in registry order. */
export function videoModelsForAds(): Model[] {
  return modelsForMode("ads").filter(isVideoModel);
}

/** Image models for the product, hook and poster panels. */
export function stillModelsForAds(): Model[] {
  return modelsForMode("ads").filter(isImageModel);
}

/** The first image model the still panels can run; the registry's first ads row is a video. */
export function defaultStillModelForAds(): Model {
  return stillModelsForAds()[0] ?? defaultModelForMode("ads");
}

/** The clip length the video panel asks for: VIDEO_DURATION_S, capped by the chosen model. */
export function videoDurationS(model: Model | undefined): number {
  return Math.min(VIDEO_DURATION_S, model?.maxDurationS ?? VIDEO_DURATION_S);
}
