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

/**
 * The split files Comfy Cloud ships (tests/fixtures/cloud-object-info.json): it has no single-file
 * LTX-2.5 checkpoint, so both LTX models load transformer, video VAE and text encoders apart.
 * LTX-2 reads Gemma 3 through its embeddings connector; LTX-2.5's Gemma 4 file carries its own.
 */
type LtxFiles = { unet: string; vae: string; textEncoders: readonly [string] | readonly [string, string] };
const LTX_FILES: Record<"ltx-2" | "ltx-25", LtxFiles> = {
  "ltx-2": {
    unet: "ltx-2-19b-dev-fp8_transformer_only.safetensors",
    vae: "LTX2_video_vae_bf16.safetensors",
    textEncoders: ["gemma_3_12B_it_fp4_mixed.safetensors", "ltx-2-19b-embeddings_connector_dev_bf16.safetensors"],
  },
  "ltx-25": {
    unet: "ltx-2.5-22b-dev-transformer-bf16.safetensors",
    vae: "ltx-2.5-video-vae-bf16.safetensors",
    textEncoders: ["gemma4-12b-with-proj-ltx-2.5-bf16.safetensors"],
  },
};
const LTX_CLIP_TYPE = "ltxv";
const LTX_FPS = 24;
/**
 * LTX's nodes step width and height by 32, and its video VAE fails to encode a 720-high first frame
 * (a real Cloud LTX-2.5 run: "can't divide axis of length 45 in chunks of 2"). 704 is the 32-step below 720.
 */
const LTX_WIDTH = VIDEO_WIDTH;
const LTX_HEIGHT = 704;
const HUNYUAN_UNET = "hunyuanvideo1.5_720p_t2v_fp16.safetensors";
const HUNYUAN_QWEN_CLIP = "qwen_2.5_vl_7b_fp8_scaled.safetensors";
const HUNYUAN_GLYPH_CLIP = "byt5_small_glyphxl_fp16.safetensors";
const HUNYUAN_CLIP_TYPE = "hunyuan_video_15";
const HUNYUAN_VAE = "hunyuanvideo15_vae_fp16.safetensors";
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

function ltxTextEncoder(builder: ReturnType<typeof createGraphBuilder>, files: LtxFiles): string {
  const [first, second] = files.textEncoders;
  return second === undefined
    ? addNode(builder, "CLIPLoader", { clip_name: first, type: LTX_CLIP_TYPE })
    : addNode(builder, "DualCLIPLoader", { clip_name1: first, clip_name2: second, type: LTX_CLIP_TYPE });
}

function ltxGraph(
  request: GenerateRequest,
  files: LtxFiles,
  imageName: string | undefined,
): WorkflowGraph {
  const builder = createGraphBuilder();
  const model = addNode(builder, "UNETLoader", { unet_name: files.unet, weight_dtype: "default" });
  const vae = addNode(builder, "VAELoader", { vae_name: files.vae });
  const clip = ltxTextEncoder(builder, files);
  const positive = addNode(builder, "CLIPTextEncode", { text: request.prompt, clip: [clip, 0] });
  const negative = addNode(builder, "CLIPTextEncode", { text: NEGATIVE_PROMPT, clip: [clip, 0] });
  const length = ltxFrames(request.durationS);

  let positiveConditioning: [string, number] = [positive, 0];
  let negativeConditioning: [string, number] = [negative, 0];
  let latent: [string, number];
  if (imageName !== undefined) {
    const image = addNode(builder, "LoadImage", { image: imageName });
    const out = addNode(builder, "LTXVImgToVideo", {
      positive: [positive, 0],
      negative: [negative, 0],
      vae: [vae, 0],
      image: [image, 0],
      width: LTX_WIDTH,
      height: LTX_HEIGHT,
      length,
      batch_size: 1,
      strength: 0.9,
    });
    positiveConditioning = [out, 0];
    negativeConditioning = [out, 1];
    latent = [out, 2];
  } else {
    const empty = addNode(builder, "EmptyLTXVLatentVideo", {
      width: LTX_WIDTH,
      height: LTX_HEIGHT,
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
    model: [model, 0],
    add_noise: true,
    noise_seed: request.seed ?? 0,
    cfg: 3,
    positive: positiveConditioning,
    negative: negativeConditioning,
    sampler: [sampler, 0],
    sigmas: [sigmas, 0],
    latent_image: latent,
  });
  const decoded = addNode(builder, "VAEDecode", { samples: [sampled, 0], vae: [vae, 0] });
  addVideoOutput(builder, decoded, "kinemi/cinematic", LTX_FPS);
  return { nodes: builder.nodes, output: "video", width: LTX_WIDTH, height: LTX_HEIGHT };
}

function hunyuanGraph(request: GenerateRequest): WorkflowGraph {
  const builder = createGraphBuilder();
  const model = addNode(builder, "UNETLoader", {
    unet_name: HUNYUAN_UNET,
    weight_dtype: "default",
  });
  const clip = addNode(builder, "DualCLIPLoader", {
    clip_name1: HUNYUAN_QWEN_CLIP,
    clip_name2: HUNYUAN_GLYPH_CLIP,
    type: HUNYUAN_CLIP_TYPE,
  });
  const vae = addNode(builder, "VAELoader", { vae_name: HUNYUAN_VAE });
  const positive = addNode(builder, "CLIPTextEncode", { text: request.prompt, clip: [clip, 0] });
  const negative = addNode(builder, "CLIPTextEncode", {
    text: NEGATIVE_PROMPT,
    clip: [clip, 0],
  });
  const latent = addNode(builder, "EmptyHunyuanVideo15Latent", {
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
    case "ltx-25": {
      if (endImageName !== "") {
        throw new Error(`the ${request.modelId} graph takes a first frame, not a last frame`);
      }
      return ltxGraph(request, LTX_FILES[request.modelId], imageName === "" ? undefined : imageName);
    }
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
