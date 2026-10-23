import { findModel } from "../../models";
import type { GenerateRequest } from "../../types";
import {
  optionalNumber,
  optionalString,
  requireString,
  type WorkflowGraph,
} from "../pipeline";
import { addNode, createGraphBuilder } from "./graph";
import { stillCheckpoint } from "./modelFiles";
import { stillGraph } from "./still";

/**
 * Fashion Factory: one graph per panel feature. Swap is a two-image edit: the garment photo is
 * image 1 and the model photo image 2, so Qwen-Image-Edit places the garment instead of drawing a
 * new still. Match and campaign are stills on the picked fashion model, with the look controls
 * written into the prompt the graph encodes.
 */

/** The Qwen-Image-Edit-2509 files the swap graph loads; change here when the deployment holds others. */
const QWEN_EDIT_UNET = "qwen_image_edit_2509_fp8_e4m3fn.safetensors";
const QWEN_EDIT_CLIP = "qwen_2.5_vl_7b_fp8_scaled.safetensors";
const QWEN_EDIT_VAE = "qwen_image_vae.safetensors";
const SWAP_SIZE = 1024;
const SWAP_STEPS = 20;
const SWAP_CFG = 2.5;
const SWAP_NEGATIVE = "blurry, low quality, distorted, extra limbs, changed face, extra garments";
const LOOK_BACKGROUNDS = ["studio", "street", "plain"];
const LIGHTING_MIN = 0;
const LIGHTING_MAX = 10;
const LIGHTING_DEFAULT = 5;

function readToggle(request: GenerateRequest, key: string): boolean {
  const value = request.params?.[key];
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new Error(`params.${key} must be a boolean when given`);
  }
  return value;
}

function requireKind(request: GenerateRequest): void {
  const model = findModel(request.modelId);
  if (model === undefined) {
    throw new Error(`fashion does not know model "${request.modelId}"`);
  }
  if (model.kind !== "image") {
    throw new Error(`fashion needs an image model here; "${model.id}" is a ${model.kind}`);
  }
}

/**
 * Garment and model swap. The edit graph only exists for the two fashion models this build wires;
 * any other row answers with the missing-graph message the route sends as a 502.
 */
function swapGraph(request: GenerateRequest): WorkflowGraph {
  if (request.modelId !== "qwen-image" && request.modelId !== "flux-2-dev") {
    throw new Error(`the deployment lacks a garment graph for model "${request.modelId}"`);
  }
  const garmentName = requireString(request.params, "imageName", "a garment swap needs a garment photo");
  const modelName = requireString(
    request.params,
    "endImageName",
    "a garment swap needs a model or person photo",
  );

  const builder = createGraphBuilder();
  const model = addNode(builder, "UNETLoader", {
    unet_name: QWEN_EDIT_UNET,
    weight_dtype: "default",
  });
  const clip = addNode(builder, "CLIPLoader", { clip_name: QWEN_EDIT_CLIP, type: "qwen_image" });
  const vae = addNode(builder, "VAELoader", { vae_name: QWEN_EDIT_VAE });
  const garment = addNode(builder, "LoadImage", { image: garmentName });
  const person = addNode(builder, "LoadImage", { image: modelName });
  const images = {
    clip: [clip, 0],
    vae: [vae, 0],
    image1: [garment, 0],
    image2: [person, 0],
  };
  const positive = addNode(builder, "TextEncodeQwenImageEditPlus", {
    ...images,
    prompt: request.prompt,
  });
  const negative = addNode(builder, "TextEncodeQwenImageEditPlus", {
    ...images,
    prompt: SWAP_NEGATIVE,
  });
  const latent = addNode(builder, "EmptySD3LatentImage", {
    width: SWAP_SIZE,
    height: SWAP_SIZE,
    batch_size: 1,
  });
  const sampled = addNode(builder, "KSampler", {
    model: [model, 0],
    seed: request.seed ?? 0,
    steps: SWAP_STEPS,
    cfg: SWAP_CFG,
    sampler_name: "euler",
    scheduler: "simple",
    positive: [positive, 0],
    negative: [negative, 0],
    latent_image: [latent, 0],
    denoise: 1,
  });
  const decoded = addNode(builder, "VAEDecode", { samples: [sampled, 0], vae: [vae, 0] });
  addNode(builder, "SaveImage", { images: [decoded, 0], filename_prefix: "kinemi/fashion-swap" });
  return { nodes: builder.nodes, output: "image", width: SWAP_SIZE, height: SWAP_SIZE };
}

/** Background, lighting and drape: every control reaches the prompt the still graph encodes. */
function matchGraph(request: GenerateRequest): WorkflowGraph {
  requireKind(request);
  const background = optionalString(request.params, "background", "studio");
  if (!LOOK_BACKGROUNDS.includes(background)) {
    throw new Error(`params.background must be one of ${LOOK_BACKGROUNDS.join(", ")}`);
  }
  const lighting = optionalNumber(request.params, "lightingMatch", LIGHTING_DEFAULT);
  if (lighting < LIGHTING_MIN || lighting > LIGHTING_MAX) {
    throw new Error(`params.lightingMatch runs ${LIGHTING_MIN}-${LIGHTING_MAX}`);
  }

  const parts = [
    request.prompt,
    `background: ${background}`,
    `lighting match: ${lighting}/${LIGHTING_MAX}`,
  ];
  if (readToggle(request, "keepDrape")) {
    parts.push("preserve the garment drape and folds");
  }
  if (readToggle(request, "keepLighting")) {
    parts.push("preserve the original lighting direction");
  }

  const shaped: GenerateRequest = { ...request, prompt: parts.join(", ") };
  return stillGraph(shaped, stillCheckpoint(request.modelId), undefined, "kinemi/fashion-match");
}

/** One campaign still per job; each model's seed is set by the client, so the cast is stable. */
function campaignGraph(request: GenerateRequest): WorkflowGraph {
  requireKind(request);
  return stillGraph(request, stillCheckpoint(request.modelId), undefined, "kinemi/fashion-campaign");
}

export function buildGraph(request: GenerateRequest): WorkflowGraph {
  const feature = requireString(request.params, "feature", "fashion needs a panel feature");
  switch (feature) {
    case "swap":
      return swapGraph(request);
    case "match":
      return matchGraph(request);
    case "campaign":
      return campaignGraph(request);
    default:
      throw new Error(`no fashion graph for feature "${feature}"`);
  }
}
