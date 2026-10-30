import type { GenerateRequest } from "../../types";
import type { WorkflowGraph } from "../pipeline";
import { addNode, createGraphBuilder, type GraphBuilder } from "./graph";
import type { StillModelFiles } from "./modelFiles";

/**
 * A still graph on split loaders (UNETLoader, CLIPLoader, VAELoader), in the layout of the
 * official ComfyUI template for the model's family. With a source name the image steers the
 * render: FLUX.2 attaches it as a reference latent, Qwen-Image samples from it at a reduced
 * denoise. Without one both start from an empty latent (text-to-image).
 */

const STILL_SIZE = 1024;
const NEGATIVE_PROMPT = "blurry, low quality, distorted, extra limbs";

const FLUX2_STEPS = 28;
const FLUX2_GUIDANCE = 4;

const QWEN_STEPS = 20;
const QWEN_CFG = 2.5;
const QWEN_SHIFT = 3.1;
const QWEN_IMG2IMG_DENOISE = 0.65;

type Loaded = { model: string; clip: string; vae: string };

function addLoaders(builder: GraphBuilder, files: StillModelFiles): Loaded {
  return {
    model: addNode(builder, "UNETLoader", { unet_name: files.unet, weight_dtype: "default" }),
    clip: addNode(builder, "CLIPLoader", { clip_name: files.textEncoder, type: files.clipType }),
    vae: addNode(builder, "VAELoader", { vae_name: files.vae }),
  };
}

function encodeSource(builder: GraphBuilder, source: string, vae: string): string {
  const image = addNode(builder, "LoadImage", { image: source });
  return addNode(builder, "VAEEncode", { pixels: [image, 0], vae: [vae, 0] });
}

/** FLUX.2: a guidance-distilled model, so one prompt through BasicGuider and its own scheduler. */
function addFlux2Sampling(builder: GraphBuilder, loaded: Loaded, request: GenerateRequest, source: string | undefined): string {
  let conditioning = addNode(builder, "CLIPTextEncode", { text: request.prompt, clip: [loaded.clip, 0] });
  if (source !== undefined) {
    const reference = encodeSource(builder, source, loaded.vae);
    conditioning = addNode(builder, "ReferenceLatent", { conditioning: [conditioning, 0], latent: [reference, 0] });
  }
  const guided = addNode(builder, "FluxGuidance", { conditioning: [conditioning, 0], guidance: FLUX2_GUIDANCE });
  const guider = addNode(builder, "BasicGuider", { model: [loaded.model, 0], conditioning: [guided, 0] });
  const latent = addNode(builder, "EmptyFlux2LatentImage", { width: STILL_SIZE, height: STILL_SIZE, batch_size: 1 });
  return addNode(builder, "SamplerCustomAdvanced", {
    noise: [addNode(builder, "RandomNoise", { noise_seed: request.seed ?? 0 }), 0],
    guider: [guider, 0],
    sampler: [addNode(builder, "KSamplerSelect", { sampler_name: "euler" }), 0],
    sigmas: [addNode(builder, "Flux2Scheduler", { steps: FLUX2_STEPS, width: STILL_SIZE, height: STILL_SIZE }), 0],
    latent_image: [latent, 0],
  });
}

/** Qwen-Image: AuraFlow sampling shift, a positive and negative prompt, and KSampler. */
function addQwenSampling(builder: GraphBuilder, loaded: Loaded, request: GenerateRequest, source: string | undefined): string {
  const model = addNode(builder, "ModelSamplingAuraFlow", { model: [loaded.model, 0], shift: QWEN_SHIFT });
  const positive = addNode(builder, "CLIPTextEncode", { text: request.prompt, clip: [loaded.clip, 0] });
  const negative = addNode(builder, "CLIPTextEncode", { text: NEGATIVE_PROMPT, clip: [loaded.clip, 0] });
  const latent =
    source === undefined
      ? addNode(builder, "EmptySD3LatentImage", { width: STILL_SIZE, height: STILL_SIZE, batch_size: 1 })
      : encodeSource(builder, source, loaded.vae);
  return addNode(builder, "KSampler", {
    model: [model, 0],
    seed: request.seed ?? 0,
    steps: QWEN_STEPS,
    cfg: QWEN_CFG,
    sampler_name: "euler",
    scheduler: "simple",
    positive: [positive, 0],
    negative: [negative, 0],
    latent_image: [latent, 0],
    denoise: source === undefined ? 1 : QWEN_IMG2IMG_DENOISE,
  });
}

export function stillGraph(
  request: GenerateRequest,
  files: StillModelFiles,
  source: string | undefined,
  prefix: string,
): WorkflowGraph {
  const builder = createGraphBuilder();
  const loaded = addLoaders(builder, files);
  const sampled =
    files.family === "flux2"
      ? addFlux2Sampling(builder, loaded, request, source)
      : addQwenSampling(builder, loaded, request, source);
  const decoded = addNode(builder, "VAEDecode", { samples: [sampled, 0], vae: [loaded.vae, 0] });
  addNode(builder, "SaveImage", { images: [decoded, 0], filename_prefix: prefix });
  return { nodes: builder.nodes, output: "image", width: STILL_SIZE, height: STILL_SIZE };
}
