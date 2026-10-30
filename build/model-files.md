# Model files

With no `COMFY_URL` Kinemi ships in demo mode: it downloads no weights and contacts no Comfy
endpoint, so a still or clip resolves to a deterministic SVG poster and an audio run to a
synthesised tone. With `COMFY_URL` the graphs below are submitted to that deployment. This file
maps each entry in `data/models.json` to what the deployment has to hold.

Each row names the family and the ComfyUI folders it loads from. The exact repositories, filenames,
sizes and commits are in `data/model-sources.json`, which `scripts/comfy-install.mjs` reads, and
`docs/comfy-deployment.md` lists them in tables. Refresh that file with
`node scripts/verify-model-sources.mjs`; it reads metadata only and downloads nothing.

## What each registry entry needs

| Registry id | Family | Vendor | ComfyUI folders | Notes | Source |
|---|---|---|---|---|---|
| `wan22-i2v` | Wan 2.2 image to video | Alibaba | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Image to video, strongest camera adherence. | Wan 2.2 model card |
| `wan22-t2v` | Wan 2.2 text to video | Alibaba | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Cheapest per second. | Wan 2.2 model card |
| `ltx-2` | LTX-2 | Lightricks | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Longest clips in the registry, 10 s cap in the UI. | LTX-2 model card |
| `ltx-25` | LTX-2.5 | Lightricks | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights (LTX-2.x community licence). The $2k bonus category. | LTX-2.5 model card |
| `hunyuan-15` | HunyuanVideo 1.5 | Tencent | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Best at faces and small motion. | HunyuanVideo 1.5 model card |
| `flux-2-dev` | FLUX.2 dev | Black Forest Labs | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Stills; the re-shoot depth source. | FLUX.2 model card |
| `flux-3-klein` | FLUX 3 Image Klein | Black Forest Labs | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights, 5.6B parameters. The FLUX bonus category. | FLUX 3 model card |
| `qwen-image` | Qwen-Image | Alibaba | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Cheapest still model. | Qwen-Image model card |
| `depth-anything-v2` | Depth Anything V2 | ByteDance | `models/depthanything` | Open weights. A depth preprocessor, not a generator. | Depth Anything V2 model card |
| `realesrgan-x4` | Real-ESRGAN x4 | XPixel | `models/upscale_models` | Open weights. 4x upscale. | Real-ESRGAN release |
| `rife-v4` | RIFE 4 | Practical-RIFE | `models/upscale_models` | Open weights. Frame interpolation. | RIFE release |
| `chatterbox` | Chatterbox | Resemble AI | ComfyUI-Chatterbox node weights | Open weights (MIT). Voiceover, voice clone, voice swap and dubbing speech. | Chatterbox model card |
| `audiogen-medium` | AudioGen Medium | Meta | none installed | Open weights (CC-BY-NC). No published node pack registers `AudioGen`, so it cannot run locally yet. | AudioGen model card |

A video family is more than one file: usually the diffusion weights, a text encoder and a VAE, and
some families ship two diffusion experts. Download every file the model card lists for the variant
in the table, not only the largest one.

## Graphs in this build

Each mode module in `lib/generate/workflows/` builds one API-format graph. The node classes below
are in submission order. There is no live deployment on this machine: the Graph column names the
official ComfyUI template the node set follows, and the only proof is
`tests/generate.backend.mjs` against the stub in `tests/lib/fake-comfy.mjs`, not a rendered file.

| Graph | Module | Node classes | Output |
|---|---|---|---|
| Cinematic, Wan 2.2 text-to-video | `cinematic.ts` → `wan.ts` | `UNETLoader` ×2, `ModelSamplingSD3` ×2, `CLIPLoader`, `VAELoader`, `CLIPTextEncode` ×2, `EmptyHunyuanLatentVideo`, `KSamplerAdvanced` ×2, `VAEDecode`, `CreateVideo`, `SaveVideo` | video |
| Cinematic, Wan 2.2 image-to-video | `cinematic.ts` → `wan.ts` | the T2V nodes with `LoadImage`, `CLIPVisionLoader`, `CLIPVisionEncode`, `WanImageToVideo` instead of the empty latent; `WanFirstLastFrameToVideo` when a last frame is sent | video |
| Cinematic, LTX-2 and LTX-2.5 | `cinematic.ts` | `UNETLoader`, `VAELoader`, `CLIPLoader` (LTX-2.5) or `DualCLIPLoader` (LTX-2), `CLIPTextEncode` ×2, `EmptyLTXVLatentVideo`, `LTXVConditioning`, `KSamplerSelect`, `LTXVScheduler`, `SamplerCustom`, `VAEDecode`, `CreateVideo`, `SaveVideo`; `LTXVImgToVideo` replaces the empty latent and conditioning for a first frame | video |
| Cinematic, HunyuanVideo 1.5 | `cinematic.ts` | `UNETLoader`, `DualCLIPLoader`, `VAELoader`, `CLIPTextEncode` ×2, `EmptyHunyuanVideo15Latent`, `KSampler`, `VAEDecode`, `CreateVideo`, `SaveVideo` | video |
| Re-shoot, FLUX.2 dev and Klein | `reshoot.ts` → `still.ts` | `UNETLoader`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode`, `LoadImage`, `VAEEncode`, `ReferenceLatent`, `FluxGuidance`, `BasicGuider`, `EmptyFlux2LatentImage`, `RandomNoise`, `KSamplerSelect`, `Flux2Scheduler`, `SamplerCustomAdvanced`, `VAEDecode`, `SaveImage` | image |
| Re-shoot, Qwen-Image | `reshoot.ts` → `still.ts` | `UNETLoader`, `CLIPLoader`, `VAELoader`, `ModelSamplingAuraFlow`, `CLIPTextEncode` ×2, `LoadImage`, `VAEEncode`, `KSampler`, `VAEDecode`, `SaveImage` | image |
| Re-shoot, video model | `reshoot.ts` → `wan.ts` | the Wan 2.2 image-to-video nodes | video |
| Soul, Ads stills, Fashion match and campaign | `soul.ts`, `ads.ts`, `fashion.ts` → `still.ts` | the re-shoot still nodes for the picked model; without a source photo FLUX.2 drops `LoadImage`, `VAEEncode` and `ReferenceLatent`, and Qwen-Image swaps them for `EmptySD3LatentImage` | image |
| Genjutsu and Edit | `genjutsu.ts`, `edit.ts` → `wan.ts` | `UNETLoader` (VACE), `ModelSamplingSD3`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode` ×2, `LoadVideo`, `GetVideoComponents`, `WanVaceToVideo`, `KSampler`, `VAEDecode`, `CreateVideo`, `SaveVideo` | video |
| Depth analysis | `depth.ts` | `LoadImage`, `DepthAnythingV2Preprocessor`, `SaveImage` | image |

The Wan T2V and I2V rows load `wan2.2_t2v_*_noise_14B_fp8_scaled.safetensors` and
`wan2.2_i2v_*_noise_14B_fp8_scaled.safetensors` respectively, with
`umt5_xxl_fp8_e4m3fn_scaled.safetensors` and `wan_2.1_vae.safetensors`; the I2V and first/last
frame variants also load `clip_vision_h.safetensors`. Genjutsu and Edit use
`wan2.1_vace_14B_fp16.safetensors`. The still graphs load split files, the names Comfy Cloud
lists: FLUX.2 dev loads `flux2_dev_fp8mixed.safetensors` with `mistral_3_small_flux2_fp8.safetensors`
(CLIP type `flux2`) and `flux2-vae.safetensors`; `flux-3-klein` loads FLUX.2 Klein 4B,
`flux-2-klein-4b.safetensors`, with `qwen_3_4b.safetensors` (CLIP type `flux2`) and
`flux2-vae.safetensors`; Qwen-Image loads `qwen_image_fp8_e4m3fn.safetensors` with
`qwen_2.5_vl_7b_fp8_scaled.safetensors` (CLIP type `qwen_image`) and `qwen_image_vae.safetensors`.
`lib/generate/workflows/modelFiles.ts` is the one place to rename the still files. The LTX files are
split like the others. LTX-2 loads `ltx-2-19b-dev-fp8_transformer_only.safetensors` and
`LTX2_video_vae_bf16.safetensors`, with `gemma_3_12B_it_fp4_mixed.safetensors` and
`ltx-2-19b-embeddings_connector_dev_bf16.safetensors` as its two text encoders. LTX-2.5 loads
`ltx-2.5-22b-dev-transformer-bf16.safetensors` and `ltx-2.5-video-vae-bf16.safetensors`, with
`gemma4-12b-with-proj-ltx-2.5-bf16.safetensors` as its one text encoder. HunyuanVideo 1.5 loads
`hunyuanvideo1.5_720p_t2v_fp16.safetensors` and `hunyuanvideo15_vae_fp16.safetensors`, with
`qwen_2.5_vl_7b_fp8_scaled.safetensors` and `byt5_small_glyphxl_fp16.safetensors` as its text
encoders. The depth graph loads `depth_anything_v2_vitl.pth`, which the Depth Anything V2 node
fetches itself on first use. The upscale graph loads `RealESRGAN_x2plus.pth` or
`RealESRGAN_x4plus.pth` and `rife47.pth`, which the RIFE node fetches itself. Match these names to
the deployment's folders before a real run; a mismatch fails at the loader node, not silently.
Three of the LTX-2 files come from a community repository; `docs/comfy-deployment.md` says which.

The repository does not pin a ComfyUI build, because no deployment exists yet. Pin the image on
first deploy and check that it ships the native video nodes (`CreateVideo`, `SaveVideo`,
`LoadVideo`, `GetVideoComponents`). A missing class comes back from `/prompt` as `node_errors`;
the module named above is the only place to change it.

The adapter reads the result by the graph's declared kind, never by the mode name:

| Kind | Output key | Written by |
|---|---|---|
| image | `images[0]` | `SaveImage` |
| video | `videos[0]` then `gifs[0]` | native `SaveVideo`, VideoHelperSuite `VHS_VideoCombine` |
| audio | `audio[0]` | `SaveAudio` |

The result URL is the deployment's `/view` endpoint with the file's `filename`, `subfolder` and
`type`, which is also how a video or audio file reaches the browser.

## Custom nodes and post-processing

The graphs call into three community node packs. The installer clones each under
`custom_nodes/<name>` and checks out the commit pinned in `data/model-sources.json`.

| Pack | Folder | Node classes used | Notes |
|---|---|---|---|
| Frame Interpolation | `custom_nodes/ComfyUI-Frame-Interpolation` | `RIFE VFI` | Frame interpolation in the upscaler. Fetches `rife47.pth` itself. |
| controlnet aux | `custom_nodes/comfyui_controlnet_aux` | `DepthAnythingV2Preprocessor` | The depth graph's preprocessor node. Fetches `depth_anything_v2_vitl.pth` itself. |
| Chatterbox | `custom_nodes/ComfyUI-Chatterbox` | `ChatterboxTTS`, `ChatterboxVC` | Voiceover, voice clone, voice swap and dubbing speech. |

Five node classes that the graphs submit have no published pack: `Deflicker` (upscale deflicker),
`AudioGen` and `AudioMatch` (sound effects), and `WhisperTranscribe` and `TranslateText` (dubbing).
The manifest records them as unresolved. Until those graphs are ported to real node packs, those
features cannot run on a local ComfyUI.

`scripts/comfy-install.mjs --check --comfy-dir <path>` checks every weight and pack in that file
against a deployment and lists the unresolved classes, and `--print` prints the clone and download
commands without touching the network. `docs/comfy-deployment.md` covers the commands and the
open-weights rule.

## Download shape

With the Hugging Face CLI installed, the shape is:

```bash
hf download <repo> --local-dir models/<folder>
```

Check `hf --help` on your machine if the command is not on `PATH`; older releases call it
`huggingface-cli download`. Repeat per file group and keep the folder names ComfyUI expects:
`diffusion_models`, `text_encoders`, `vae`.

## Connecting the app

Once the deployment holds the files:

```bash
COMFY_URL=http://127.0.0.1:8188 npm run start
```

`COMFY_API_KEY` is only needed when the endpoint requires auth. Without `COMFY_URL` the app stays in
demo mode, and the badge in the top bar says so.

## Hardware

The guarded launcher (`npm run start`) checks the machine before the stack comes up. The defaults
are 16 GB RAM, 8 GB VRAM and 20 GB free disk. Below any floor it prints the shortfall and stops
instead of starting a render that would fail halfway. Override a floor only on purpose:

```bash
KINEMI_MIN_VRAM_GB=12 KINEMI_MIN_RAM_GB=32 npm run start
```

`KINEMI_SKIP_GUARD=1` skips the probe for a machine that renders elsewhere.
