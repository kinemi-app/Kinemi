import type { GenerateRequest } from "../../types";
import { optionalString, type WorkflowGraph } from "../pipeline";
import {
  addNode,
  addVideoOutput,
  createGraphBuilder,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "./graph";
import { wanVideoGraph } from "./wan";

/**
 * Cinematic: one clip per submit. The Wan 2.2 rows share the Wan family graph and the inputs pick
 * text-to-video, image-to-video or first/last-frame; LTX-2 and HunyuanVideo 1.5 have their own
 * text-to-video templates. A model whose deployment nodes are not in this build throws a named
 * error instead of silently running another family.
 */

const NEGATIVE_PROMPT = "blurry, low quality, distorted";
const LTX_CHECKPOINT = "ltx-2-dev.safetensors";
const LTX_FPS = 24;
const HUNYUAN_UNET = "hunyuan_video_15_t2v_fp8_scaled.safetensors";
const HUNYUAN_CLIP = "llava_llama3_fp8_scaled.safetensors";
const HUNYUAN_VAE = "hunyuan_video_vae_bf16.safetensors";
const HUNYUAN_FPS = 24;
const HUNYUAN_STEPS = 30;
const HUNYUAN_CFG = 6;

/** LTX takes a 8n+1 frame count at 24 fps. */
function ltxFrames(durationS: number): number {
  return Math.max(9, Math.round((durationS * LTX_FPS) / 8) * 8 + 1);
}

/** Hunyuan takes a 4n+1 frame count at 24 fps. */
function hunyuanFrames(durationS: number): number {
  return Math.max(5, Math.round((durationS * HUNYUAN_FPS) / 4) * 4 + 1);
}

function ltxGraph(request: GenerateRequest, imageName: string | undefined): WorkflowGraph {
  const builder = createGraphBuilder();
  const checkpoint = addNode(builder, "CheckpointLoaderSimple", { ckpt_name: LTX_CHECKPOINT });
  const positive = addNode(builder, "CLIPTextEncode", {
    text: request.prompt,
    clip: [checkpoint, 1],
  });
  const negative = addNode(builder, "CLIPTextEncode", {
    text: NEGATIVE_PROMPT,
    clip: [checkpoint, 1],
  });
  const length = ltxFrames(request.durationS);

  let positiveConditioning: [string, number] = [positive, 0];
  let negativeConditioning: [string, number] = [negative, 0];
  let latent: [string, number];
  if (imageName !== undefined) {
    const image = addNode(builder, "LoadImage", { image: imageName });
    const out = addNode(builder, "LTXVImgToVideo", {
      positive: [positive, 0],
      negative: [negative, 0],
      vae: [checkpoint, 2],
      image: [image, 0],
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      length,
      batch_size: 1,
      strength: 0.9,
    });
    positiveConditioning = [out, 0];
    negativeConditioning = [out, 1];
    latent = [out, 2];
  } else {
    const empty = addNode(builder, "EmptyLTXVLatentVideo", {
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      length,
      batch_size: 1,
    });
    const conditioning = addNode(builder, "LTXVConditioning", {
      positive: [positive, 0],
      negative: [negative, 0],
      frame_rate: LTX_FPS,
    });
    positiveConditioning = [conditioning, 0];
    negativeConditioning = [conditioning, 1];
    latent = [empty, 0];
  }

  const sampler = addNode(builder, "KSamplerSelect", { sampler_name: "euler" });
  const sigmas = addNode(builder, "LTXVScheduler", {
    steps: 30,
    max_shift: 2.05,
    base_shift: 0.95,
    stretch: true,
    terminal: 0.1,
  });
  const sampled = addNode(builder, "SamplerCustom", {
    model: [checkpoint, 0],
    add_noise: true,
    noise_seed: request.seed ?? 0,
    cfg: 3,
    positive: positiveConditioning,
    negative: negativeConditioning,
    sampler: [sampler, 0],
    sigmas: [sigmas, 0],
    latent_image: latent,
  });
  const decoded = addNode(builder, "VAEDecode", { samples: [sampled, 0], vae: [checkpoint, 2] });
  addVideoOutput(builder, decoded, "kinemi/cinematic", LTX_FPS);
  return { nodes: builder.nodes, output: "video", width: VIDEO_WIDTH, height: VIDEO_HEIGHT };
}

function hunyuanGraph(request: GenerateRequest): WorkflowGraph {
  const builder = createGraphBuilder();
  const model = addNode(builder, "UNETLoader", {
    unet_name: HUNYUAN_UNET,
    weight_dtype: "default",
  });
  const clip = addNode(builder, "CLIPLoader", {
    clip_name: HUNYUAN_CLIP,
    type: "hunyuan_video",
  });
  const vae = addNode(builder, "VAELoader", { vae_name: HUNYUAN_VAE });
  const positive = addNode(builder, "CLIPTextEncode", { text: request.prompt, clip: [clip, 0] });
  const negative = addNode(builder, "CLIPTextEncode", {
    text: NEGATIVE_PROMPT,
    clip: [clip, 0],
  });
  const latent = addNode(builder, "EmptyHunyuanLatentVideo", {
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    length: hunyuanFrames(request.durationS),
    batch_size: 1,
  });
  const sampled = addNode(builder, "KSampler", {
    model: [model, 0],
    seed: request.seed ?? 0,
    steps: HUNYUAN_STEPS,
    cfg: HUNYUAN_CFG,
    sampler_name: "euler",
    scheduler: "simple",
    positive: [positive, 0],
    negative: [negative, 0],
    latent_image: [latent, 0],
    denoise: 1,
  });
  const decoded = addNode(builder, "VAEDecode", { samples: [sampled, 0], vae: [vae, 0] });
  addVideoOutput(builder, decoded, "kinemi/cinematic", HUNYUAN_FPS);
  return { nodes: builder.nodes, output: "video", width: VIDEO_WIDTH, height: VIDEO_HEIGHT };
}

export function graph(request: GenerateRequest): WorkflowGraph {
  const imageName = optionalString(request.params, "imageName", "");
  const endImageName = optionalString(request.params, "endImageName", "");
  if (endImageName !== "" && imageName === "") {
    throw new Error("a last frame needs a first frame: params.imageName is missing");
  }

  switch (request.modelId) {
    case "wan22-t2v":
    case "wan22-i2v":
      return imageName === ""
        ? wanVideoGraph(request, { kind: "text" }, "kinemi/cinematic")
        : wanVideoGraph(
            request,
            { kind: "image", imageName, ...(endImageName === "" ? {} : { endImageName }) },
            "kinemi/cinematic",
          );
    case "ltx-2":
      if (endImageName !== "") {
        throw new Error("the LTX-2 graph takes a first frame, not a last frame");
      }
      return ltxGraph(request, imageName === "" ? undefined : imageName);
    case "hunyuan-15":
      if (endImageName !== "") {
        throw new Error("the HunyuanVideo 1.5 graph takes a first frame, not a last frame");
      }
      if (imageName !== "") {
        throw new Error("hunyuan-15 has no image-to-video graph in this build");
      }
      return hunyuanGraph(request);
    default:
      throw new Error(`no cinematic graph for model "${request.modelId}"`);
  }
}
