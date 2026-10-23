import type { GenerateRequest } from "../../types";
import type { WorkflowGraph } from "../pipeline";
import { addNode, createGraphBuilder } from "./graph";

/**
 * A single-checkpoint still graph. With a source name it encodes that image and samples at a
 * reduced denoise (image-to-image); without one it starts from an empty latent (text-to-image).
 */

const STILL_SIZE = 1024;
const NEGATIVE_PROMPT = "blurry, low quality, distorted, extra limbs";
const IMG2IMG_DENOISE = 0.65;
const STEPS = 28;
const CFG = 3.5;

export function stillGraph(
  request: GenerateRequest,
  checkpoint: string,
  source: string | undefined,
  prefix: string,
): WorkflowGraph {
  const builder = createGraphBuilder();
  const model = addNode(builder, "CheckpointLoaderSimple", { ckpt_name: checkpoint });
  const positive = addNode(builder, "CLIPTextEncode", { text: request.prompt, clip: [model, 1] });
  const negative = addNode(builder, "CLIPTextEncode", {
    text: NEGATIVE_PROMPT,
    clip: [model, 1],
  });

  let latent: string;
  let denoise = 1;
  if (source !== undefined) {
    const image = addNode(builder, "LoadImage", { image: source });
    latent = addNode(builder, "VAEEncode", { pixels: [image, 0], vae: [model, 2] });
    denoise = IMG2IMG_DENOISE;
  } else {
    latent = addNode(builder, "EmptyLatentImage", {
      width: STILL_SIZE,
      height: STILL_SIZE,
      batch_size: 1,
    });
  }

  const sampled = addNode(builder, "KSampler", {
    model: [model, 0],
    seed: request.seed ?? 0,
    steps: STEPS,
    cfg: CFG,
    sampler_name: "euler",
    scheduler: "normal",
    positive: [positive, 0],
    negative: [negative, 0],
    latent_image: [latent, 0],
    denoise,
  });
  const decoded = addNode(builder, "VAEDecode", { samples: [sampled, 0], vae: [model, 2] });
  addNode(builder, "SaveImage", { images: [decoded, 0], filename_prefix: prefix });
  return { nodes: builder.nodes, output: "image", width: STILL_SIZE, height: STILL_SIZE };
}
