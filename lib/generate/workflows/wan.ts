import type { GenerateRequest } from "../../types";
import type { WorkflowGraph } from "../pipeline";
import {
  addNode,
  addVideoOutput,
  createGraphBuilder,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type GraphBuilder,
} from "./graph";

/**
 * The Wan 2.2 family graph, in the node order of ComfyUI's official template: two noise experts
 * sampled in sequence, the prompt from `CLIPTextEncode`, and a native `SaveVideo` output. The same
 * module covers text-to-video, image-to-video, first/last-frame and VACE video-to-video so every
 * Wan mode sends the deployment one family of nodes.
 */

const WAN_FPS = 16;
const CLIP_FILE = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
const VAE_FILE = "wan_2.1_vae.safetensors";
const CLIP_VISION_FILE = "clip_vision_h.safetensors";
const NEGATIVE_PROMPT = "blurry, low quality, distorted, extra limbs";

const T2V_WEIGHTS = {
  high: "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
  low: "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
};
const I2V_WEIGHTS = {
  high: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
  low: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
};
const VACE_WEIGHTS = { single: "wan2.1_vace_14B_fp16.safetensors" };

type Weights = typeof T2V_WEIGHTS | { single: string };
type Connection = [string, number];

type Conditioning = {
  positive: Connection;
  negative: Connection;
  latent: Connection;
};

type Loaders = {
  models: string[];
  clip: string;
  vae: string;
};

/** What the graph should animate: a prompt, a still, a still pair, or a source clip. */
export type WanSource =
  | { kind: "text" }
  | { kind: "image"; imageName: string; endImageName?: string }
  | { kind: "video"; videoName: string; controlStrength: number };

/** A 16 fps Wan clip, padded to the 4n+1 frame count the sampler expects and capped at 5 s. */
function videoFrames(durationS: number): number {
  const requested = Math.round(durationS * WAN_FPS) + 1;
  return Math.min(Math.max(requested, 17), 81);
}

function addWeights(builder: GraphBuilder, weights: Weights): string[] {
  if ("single" in weights) {
    const model = addNode(builder, "UNETLoader", {
      unet_name: weights.single,
      weight_dtype: "default",
    });
    return [addNode(builder, "ModelSamplingSD3", { model: [model, 0], shift: 8 })];
  }

  const high = addNode(builder, "UNETLoader", {
    unet_name: weights.high,
    weight_dtype: "default",
  });
  const low = addNode(builder, "UNETLoader", {
    unet_name: weights.low,
    weight_dtype: "default",
  });
  return [
    addNode(builder, "ModelSamplingSD3", { model: [high, 0], shift: 8 }),
    addNode(builder, "ModelSamplingSD3", { model: [low, 0], shift: 8 }),
  ];
}

function addLoaders(builder: GraphBuilder, weights: Weights): Loaders {
  const models = addWeights(builder, weights);
  const clip = addNode(builder, "CLIPLoader", { clip_name: CLIP_FILE, type: "wan" });
  const vae = addNode(builder, "VAELoader", { vae_name: VAE_FILE });
  return { models, clip, vae };
}

function addText(
  builder: GraphBuilder,
  clip: string,
  prompt: string,
): { positive: string; negative: string } {
  return {
    positive: addNode(builder, "CLIPTextEncode", { text: prompt, clip: [clip, 0] }),
    negative: addNode(builder, "CLIPTextEncode", { text: NEGATIVE_PROMPT, clip: [clip, 0] }),
  };
}

function addTextToVideo(
  builder: GraphBuilder,
  text: { positive: string; negative: string },
  length: number,
): Conditioning {
  const latent = addNode(builder, "EmptyHunyuanLatentVideo", {
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    length,
    batch_size: 1,
  });
  return {
    positive: [text.positive, 0],
    negative: [text.negative, 0],
    latent: [latent, 0],
  };
}

function addImageToVideo(
  builder: GraphBuilder,
  loaders: Loaders,
  text: { positive: string; negative: string },
  source: { imageName: string; endImageName?: string },
  length: number,
): Conditioning {
  const image = addNode(builder, "LoadImage", { image: source.imageName });
  const clipVision = addNode(builder, "CLIPVisionLoader", { clip_name: CLIP_VISION_FILE });
  const start = addNode(builder, "CLIPVisionEncode", {
    clip_vision: [clipVision, 0],
    image: [image, 0],
    crop: "none",
  });
  const geometry = {
    positive: [text.positive, 0],
    negative: [text.negative, 0],
    vae: [loaders.vae, 0],
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    length,
    batch_size: 1,
  };

  if (source.endImageName !== undefined) {
    const endImage = addNode(builder, "LoadImage", { image: source.endImageName });
    const end = addNode(builder, "CLIPVisionEncode", {
      clip_vision: [clipVision, 0],
      image: [endImage, 0],
      crop: "none",
    });
    const out = addNode(builder, "WanFirstLastFrameToVideo", {
      ...geometry,
      clip_vision_start_image: [start, 0],
      clip_vision_end_image: [end, 0],
      start_image: [image, 0],
      end_image: [endImage, 0],
    });
    return { positive: [out, 0], negative: [out, 1], latent: [out, 2] };
  }

  const out = addNode(builder, "WanImageToVideo", {
    ...geometry,
    start_image: [image, 0],
    clip_vision_output: [start, 0],
  });
  return { positive: [out, 0], negative: [out, 1], latent: [out, 2] };
}

function addVideoToVideo(
  builder: GraphBuilder,
  loaders: Loaders,
  text: { positive: string; negative: string },
  source: { videoName: string; controlStrength: number },
  length: number,
): Conditioning {
  const video = addNode(builder, "LoadVideo", { file: source.videoName });
  const parts = addNode(builder, "GetVideoComponents", { video: [video, 0] });
  const out = addNode(builder, "WanVaceToVideo", {
    positive: [text.positive, 0],
    negative: [text.negative, 0],
    vae: [loaders.vae, 0],
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    length,
    batch_size: 1,
    control_video: [parts, 0],
    control_strength: source.controlStrength,
  });
  return { positive: [out, 0], negative: [out, 1], latent: [out, 2] };
}

function addSamplers(
  builder: GraphBuilder,
  loaders: Loaders,
  conditioning: Conditioning,
  seed: number,
): string {
  const [high, low] = loaders.models;

  if (loaders.models.length === 1) {
    if (!high) {
      throw new Error("the Wan sampler needs a model loader");
    }
    const sampled = addNode(builder, "KSampler", {
      model: [high, 0],
      seed,
      steps: 20,
      cfg: 6,
      sampler_name: "euler",
      scheduler: "simple",
      positive: conditioning.positive,
      negative: conditioning.negative,
      latent_image: conditioning.latent,
      denoise: 1,
    });
    return addNode(builder, "VAEDecode", { samples: [sampled, 0], vae: [loaders.vae, 0] });
  }

  if (!high || !low) {
    throw new Error("the Wan two-expert sampler needs both noise models");
  }
  const first = addNode(builder, "KSamplerAdvanced", {
    model: [high, 0],
    add_noise: "enable",
    noise_seed: seed,
    steps: 20,
    cfg: 3.5,
    sampler_name: "euler",
    scheduler: "simple",
    positive: conditioning.positive,
    negative: conditioning.negative,
    latent_image: conditioning.latent,
    start_at_step: 0,
    end_at_step: 10,
    return_with_leftover_noise: "enable",
  });
  const second = addNode(builder, "KSamplerAdvanced", {
    model: [low, 0],
    add_noise: "disable",
    noise_seed: seed,
    steps: 20,
    cfg: 3.5,
    sampler_name: "euler",
    scheduler: "simple",
    positive: conditioning.positive,
    negative: conditioning.negative,
    latent_image: [first, 0],
    start_at_step: 10,
    end_at_step: 20,
    return_with_leftover_noise: "disable",
  });
  return addNode(builder, "VAEDecode", { samples: [second, 0], vae: [loaders.vae, 0] });
}

/** Build one Wan 2.2 clip. The declared output is always video; every variant saves with `SaveVideo`. */
export function wanVideoGraph(
  request: GenerateRequest,
  source: WanSource,
  prefix: string,
): WorkflowGraph {
  const builder = createGraphBuilder();
  const weights =
    source.kind === "text" ? T2V_WEIGHTS : source.kind === "video" ? VACE_WEIGHTS : I2V_WEIGHTS;
  const loaders = addLoaders(builder, weights);
  const text = addText(builder, loaders.clip, request.prompt);
  const length = videoFrames(request.durationS);

  const conditioning =
    source.kind === "text"
      ? addTextToVideo(builder, text, length)
      : source.kind === "video"
        ? addVideoToVideo(builder, loaders, text, source, length)
        : addImageToVideo(builder, loaders, text, source, length);

  const images = addSamplers(builder, loaders, conditioning, request.seed ?? 0);
  addVideoOutput(builder, images, prefix, WAN_FPS);
  return { nodes: builder.nodes, output: "video", width: VIDEO_WIDTH, height: VIDEO_HEIGHT };
}
