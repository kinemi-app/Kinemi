// Every model file the Comfy graphs load: the loader node that asks for it, the folder it goes in under
// ComfyUI/models, and the models that need it. Names follow ComfyUI's example workflows; Settings → Models
// maps each one to the file on your machine, and comfy.ts uses whatever name is set there.

export interface ModelFile {
  /** the file's name in ComfyUI's example workflows, and the key for your own name */
  id: string;
  /** the loader node (class_type) and the input that takes the file */
  node: string;
  input: string;
  /** under ComfyUI/models */
  folder: string;
  role: string;
  usedBy: string[];
  /** a custom node pack that fetches the file by itself */
  pack?: string;
}

export const MODEL_FILES: ModelFile[] = [
  { id: 'wan2.2_ti2v_5B_fp16.safetensors', node: 'UNETLoader', input: 'unet_name', folder: 'diffusion_models', role: 'Diffusion model', usedBy: ['Wan 2.2', 'Wan 2.2 I2V'] },
  { id: 'wan2.2_vae.safetensors', node: 'VAELoader', input: 'vae_name', folder: 'vae', role: 'VAE', usedBy: ['Wan 2.2', 'Wan 2.2 I2V'] },
  { id: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', node: 'CLIPLoader', input: 'clip_name', folder: 'text_encoders', role: 'Text encoder', usedBy: ['Wan 2.2', 'Wan VACE'] },
  { id: 'wan2.1_vace_14B_fp16.safetensors', node: 'UNETLoader', input: 'unet_name', folder: 'diffusion_models', role: 'Diffusion model', usedBy: ['Wan VACE (Edit, Genjutsu)'] },
  { id: 'wan_2.1_vae.safetensors', node: 'VAELoader', input: 'vae_name', folder: 'vae', role: 'VAE', usedBy: ['Wan VACE'] },
  { id: 'ltx-video-2b-v0.9.5.safetensors', node: 'CheckpointLoaderSimple', input: 'ckpt_name', folder: 'checkpoints', role: 'Checkpoint', usedBy: ['LTX-Video'] },
  { id: 't5xxl_fp16.safetensors', node: 'CLIPLoader', input: 'clip_name', folder: 'text_encoders', role: 'Text encoder', usedBy: ['LTX-Video', 'FLUX.1 [dev]'] },
  { id: 'hunyuan_video_t2v_720p_bf16.safetensors', node: 'UNETLoader', input: 'unet_name', folder: 'diffusion_models', role: 'Diffusion model', usedBy: ['HunyuanVideo'] },
  { id: 'hunyuan_video_v2_replace_image_to_video_720p_bf16.safetensors', node: 'UNETLoader', input: 'unet_name', folder: 'diffusion_models', role: 'Diffusion model', usedBy: ['HunyuanVideo I2V'] },
  { id: 'llava_llama3_fp8_scaled.safetensors', node: 'CLIPLoader', input: 'clip_name', folder: 'text_encoders', role: 'Text encoder', usedBy: ['HunyuanVideo', 'HunyuanVideo I2V'] },
  { id: 'clip_l.safetensors', node: 'CLIPLoader', input: 'clip_name', folder: 'text_encoders', role: 'Text encoder', usedBy: ['HunyuanVideo', 'FLUX.1 [dev]', 'FLUX.1 Kontext'] },
  { id: 'hunyuan_video_vae_bf16.safetensors', node: 'VAELoader', input: 'vae_name', folder: 'vae', role: 'VAE', usedBy: ['HunyuanVideo', 'HunyuanVideo I2V'] },
  { id: 'flux1-dev.safetensors', node: 'UNETLoader', input: 'unet_name', folder: 'diffusion_models', role: 'Diffusion model', usedBy: ['FLUX.1 [dev]'] },
  { id: 'flux1-dev-kontext_fp8_scaled.safetensors', node: 'UNETLoader', input: 'unet_name', folder: 'diffusion_models', role: 'Diffusion model', usedBy: ['FLUX.1 Kontext'] },
  { id: 't5xxl_fp8_e4m3fn_scaled.safetensors', node: 'CLIPLoader', input: 'clip_name', folder: 'text_encoders', role: 'Text encoder', usedBy: ['FLUX.1 Kontext'] },
  { id: 'ae.safetensors', node: 'VAELoader', input: 'vae_name', folder: 'vae', role: 'VAE', usedBy: ['FLUX.1 [dev]', 'FLUX.1 Kontext'] },
  { id: 'qwen_image_fp8_e4m3fn.safetensors', node: 'UNETLoader', input: 'unet_name', folder: 'diffusion_models', role: 'Diffusion model', usedBy: ['Qwen-Image'] },
  { id: 'qwen_image_edit_fp8_e4m3fn.safetensors', node: 'UNETLoader', input: 'unet_name', folder: 'diffusion_models', role: 'Diffusion model', usedBy: ['Qwen-Image-Edit'] },
  { id: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', node: 'CLIPLoader', input: 'clip_name', folder: 'text_encoders', role: 'Text encoder', usedBy: ['Qwen-Image', 'Qwen-Image-Edit'] },
  { id: 'qwen_image_vae.safetensors', node: 'VAELoader', input: 'vae_name', folder: 'vae', role: 'VAE', usedBy: ['Qwen-Image', 'Qwen-Image-Edit'] },
  { id: '4x-UltraSharp.pth', node: 'UpscaleModelLoader', input: 'model_name', folder: 'upscale_models', role: 'Upscaler', usedBy: ['Upscale'] },
  { id: 'rife47.pth', node: 'RIFE VFI', input: 'ckpt_name', folder: 'custom_nodes/ComfyUI-Frame-Interpolation', role: 'Frame interpolation', usedBy: ['Upscale at 48 or 60 fps'], pack: 'ComfyUI-Frame-Interpolation' },
];

export const FOLDERS = [...new Set(MODEL_FILES.map((f) => f.folder))];
