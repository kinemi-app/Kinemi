import { findModel } from "../../models";
import type { GenerateRequest } from "../../types";
import {
  optionalString,
  requireString,
  type WorkflowGraph,
  type WorkflowNode,
} from "../pipeline";
import { addNode, createGraphBuilder } from "./graph";
import { stillCheckpoint } from "./modelFiles";
import { stillGraph } from "./still";
import { wanVideoGraph } from "./wan";

/**
 * Marketing Studio: one graph per panel feature. Product, hook and poster runs are stills on the
 * picked image model. UGC, unboxing and tutorial runs are clips; with a product photo the graph
 * composes the product into the scene on the Kontext edit model and animates that still, because
 * image-to-video alone only moves the pixels it is given.
 */

/** The FLUX.1 Kontext files the compose stage loads; change here when the deployment holds others. */
const KONTEXT_UNET = "flux1-kontext-dev.safetensors";
const KONTEXT_CLIP_L = "clip_l.safetensors";
const KONTEXT_CLIP_T5 = "t5xxl_fp16.safetensors";
const KONTEXT_VAE = "ae.safetensors";
const KONTEXT_STEPS = 20;
const KONTEXT_CFG = 1;
const KONTEXT_GUIDANCE = 2.5;
const COMPOSE_PREFIX = "compose-";

function isConnection(value: unknown): value is [string, number] {
  return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number";
}

/** Re-key one builder's nodes so their ids cannot collide with the clip graph they join. */
function rekey(nodes: Record<string, WorkflowNode>, prefix: string): Record<string, WorkflowNode> {
  const result: Record<string, WorkflowNode> = {};
  for (const [id, entry] of Object.entries(nodes)) {
    const inputs: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(entry.inputs)) {
      inputs[name] =
        isConnection(value) && nodes[value[0]] !== undefined
          ? [`${prefix}${value[0]}`, value[1]]
          : value;
    }
    result[`${prefix}${id}`] = { class_type: entry.class_type, inputs };
  }
  return result;
}

/** Compose the product photo into the prompt's scene with the Kontext edit model. */
function addComposeStage(
  request: GenerateRequest,
  imageName: string,
): { nodes: Record<string, WorkflowNode>; image: string } {
  const builder = createGraphBuilder();
  const model = addNode(builder, "UNETLoader", { unet_name: KONTEXT_UNET, weight_dtype: "default" });
  const clip = addNode(builder, "DualCLIPLoader", {
    clip_name1: KONTEXT_CLIP_L,
    clip_name2: KONTEXT_CLIP_T5,
    type: "flux",
  });
  const vae = addNode(builder, "VAELoader", { vae_name: KONTEXT_VAE });
  const product = addNode(builder, "LoadImage", { image: imageName });
  const scaled = addNode(builder, "FluxKontextImageScale", { image: [product, 0] });
  const encoded = addNode(builder, "VAEEncode", { pixels: [scaled, 0], vae: [vae, 0] });
  const text = addNode(builder, "CLIPTextEncode", { text: request.prompt, clip: [clip, 0] });
  const guided = addNode(builder, "FluxGuidance", {
    conditioning: [text, 0],
    guidance: KONTEXT_GUIDANCE,
  });
  const positive = addNode(builder, "ReferenceLatent", {
    conditioning: [guided, 0],
    latent: [encoded, 0],
  });
  const empty = addNode(builder, "ConditioningZeroOut", { conditioning: [text, 0] });
  const negative = addNode(builder, "ReferenceLatent", {
    conditioning: [empty, 0],
    latent: [encoded, 0],
  });
  const sampled = addNode(builder, "KSampler", {
    model: [model, 0],
    seed: request.seed ?? 0,
    steps: KONTEXT_STEPS,
    cfg: KONTEXT_CFG,
    sampler_name: "euler",
    scheduler: "simple",
    positive: [positive, 0],
    negative: [negative, 0],
    latent_image: [encoded, 0],
    denoise: 1,
  });
  const image = addNode(builder, "VAEDecode", { samples: [sampled, 0], vae: [vae, 0] });
  return { nodes: rekey(builder.nodes, COMPOSE_PREFIX), image: `${COMPOSE_PREFIX}${image}` };
}

/**
 * Compose, then animate the composed still: the Wan start image and its CLIP-vision input point at
 * the compose output instead of a LoadImage node, so the clip opens on the product in the scene.
 */
function composedClip(request: GenerateRequest, imageName: string): WorkflowGraph {
  const graph = wanVideoGraph(request, { kind: "image", imageName }, "kinemi/ads");
  const compose = addComposeStage(request, imageName);

  for (const [id, entry] of Object.entries(graph.nodes)) {
    if (entry.class_type === "LoadImage") {
      delete graph.nodes[id];
    }
    if (entry.class_type === "CLIPVisionEncode") {
      entry.inputs.image = [compose.image, 0];
    }
    if (entry.class_type === "WanImageToVideo") {
      entry.inputs.start_image = [compose.image, 0];
    }
  }

  Object.assign(graph.nodes, compose.nodes);
  return graph;
}

function requireKind(request: GenerateRequest, kind: "image" | "video"): void {
  const model = findModel(request.modelId);
  if (model === undefined) {
    throw new Error(`ads does not know model "${request.modelId}"`);
  }
  if (model.kind !== kind) {
    throw new Error(`ads needs a ${kind} model here; "${model.id}" is a ${model.kind}`);
  }
}

function still(request: GenerateRequest, imageName: string | undefined, prefix: string): WorkflowGraph {
  requireKind(request, "image");
  return stillGraph(request, stillCheckpoint(request.modelId), imageName, prefix);
}

function video(request: GenerateRequest, imageName: string): WorkflowGraph {
  requireKind(request, "video");
  return imageName === ""
    ? wanVideoGraph(request, { kind: "text" }, "kinemi/ads")
    : composedClip(request, imageName);
}

export function buildGraph(request: GenerateRequest): WorkflowGraph {
  const feature = requireString(request.params, "feature", "ads needs a panel feature");
  const imageName = optionalString(request.params, "imageName", "");

  switch (feature) {
    case "product": {
      const product = requireString(request.params, "imageName", "a product ad needs a product photo");
      return still(request, product, "kinemi/ads-product");
    }
    case "hooks":
      return still(request, undefined, "kinemi/ads-hooks");
    case "posters":
      return still(request, imageName === "" ? undefined : imageName, "kinemi/ads-poster");
    case "ugc":
    case "unboxing":
    case "tutorial":
      return video(request, imageName);
    default:
      throw new Error(`no ads graph for feature "${feature}"`);
  }
}
