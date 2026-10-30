/**
 * The split model files the still graphs ask ComfyUI for: diffusion weights (UNETLoader), text
 * encoder (CLIPLoader) and VAE (VAELoader). The names are the ones Comfy Cloud's object_info lists
 * (tests/fixtures/cloud-object-info.json); change one here and in build/model-files.md when the
 * deployment holds a different file. A model with no entry has no still graph yet, which the
 * caller turns into a named 502.
 */

/** Which graph layout a still model needs: FLUX.2 samples with a guider, Qwen-Image with KSampler. */
export type StillFamily = "flux2" | "qwen-image";

export type StillModelFiles = {
  family: StillFamily;
  unet: string;
  textEncoder: string;
  /** CLIPLoader's `type` option, which tells Comfy how to read the text encoder. */
  clipType: string;
  vae: string;
};

const STILL_MODEL_FILES: Record<string, StillModelFiles> = {
  "flux-2-dev": {
    family: "flux2",
    unet: "flux2_dev_fp8mixed.safetensors",
    textEncoder: "mistral_3_small_flux2_fp8.safetensors",
    clipType: "flux2",
    vae: "flux2-vae.safetensors",
  },
  // The registry's Klein entry runs on Cloud's FLUX.2 Klein 4B weights, which share the FLUX.2 VAE.
  "flux-3-klein": {
    family: "flux2",
    unet: "flux-2-klein-4b.safetensors",
    textEncoder: "qwen_3_4b.safetensors",
    clipType: "flux2",
    vae: "flux2-vae.safetensors",
  },
  "qwen-image": {
    family: "qwen-image",
    unet: "qwen_image_fp8_e4m3fn.safetensors",
    textEncoder: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    clipType: "qwen_image",
    vae: "qwen_image_vae.safetensors",
  },
};

/**
 * The files one still model loads. The name predates the split loaders; ads.ts still imports it,
 * so it stays until that module moves with it.
 */
export function stillCheckpoint(modelId: string): StillModelFiles {
  const files = STILL_MODEL_FILES[modelId];
  if (files === undefined) {
    throw new Error(`no still graph for model "${modelId}"`);
  }
  return files;
}
