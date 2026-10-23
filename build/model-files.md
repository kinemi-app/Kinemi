# Model files

With no `COMFY_URL` Kinemi ships in demo mode: it downloads no weights and contacts no Comfy
endpoint, so a still or clip resolves to a deterministic SVG poster and an audio run to a
synthesised tone. With `COMFY_URL` the graphs below are submitted to that deployment. This file
maps each entry in `data/models.json` to what the deployment has to hold.

The exact repositories and filenames move with every model release, so they are not copied here
where they would go stale. Each row names the family and the ComfyUI folders it loads from; take
the current file list from that family's official model card.

## What each registry entry needs

| Registry id | Family | Vendor | ComfyUI folders | Notes |
|---|---|---|---|---|
| `wan22-i2v` | Wan 2.2 image to video | Alibaba | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Image to video, strongest camera adherence. |
| `wan22-t2v` | Wan 2.2 text to video | Alibaba | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Cheapest per second. |
| `ltx-2` | LTX-2 | Lightricks | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Longest clips in the registry, 10 s cap in the UI. |
| `hunyuan-15` | HunyuanVideo 1.5 | Tencent | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Best at faces and small motion. |
| `flux-2-dev` | FLUX.2 dev | Black Forest Labs | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Stills; the re-shoot depth source. |
| `qwen-image` | Qwen-Image | Alibaba | `models/diffusion_models`, `models/text_encoders`, `models/vae` | Open weights. Cheapest still model. |

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
| Cinematic, LTX-2 | `cinematic.ts` | `CheckpointLoaderSimple`, `CLIPTextEncode` ×2, `EmptyLTXVLatentVideo`, `LTXVConditioning`, `KSamplerSelect`, `LTXVScheduler`, `SamplerCustom`, `VAEDecode`, `CreateVideo`, `SaveVideo`; `LTXVImgToVideo` replaces the empty latent and conditioning for a first frame | video |
| Cinematic, HunyuanVideo 1.5 | `cinematic.ts` | `UNETLoader`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode` ×2, `EmptyHunyuanLatentVideo`, `KSampler`, `VAEDecode`, `CreateVideo`, `SaveVideo` | video |
| Re-shoot, still model | `reshoot.ts` → `still.ts` | `CheckpointLoaderSimple`, `CLIPTextEncode` ×2, `LoadImage`, `VAEEncode`, `KSampler`, `VAEDecode`, `SaveImage` | image |
| Re-shoot, video model | `reshoot.ts` → `wan.ts` | the Wan 2.2 image-to-video nodes | video |
| Soul | `soul.ts` → `still.ts` | the still nodes; `LoadImage` + `VAEEncode` with a source photo, `EmptyLatentImage` without it | image |
| Genjutsu and Edit | `genjutsu.ts`, `edit.ts` → `wan.ts` | `UNETLoader` (VACE), `ModelSamplingSD3`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode` ×2, `LoadVideo`, `GetVideoComponents`, `WanVaceToVideo`, `KSampler`, `VAEDecode`, `CreateVideo`, `SaveVideo` | video |

The Wan T2V and I2V rows load `wan2.2_t2v_*_noise_14B_fp8_scaled.safetensors` and
`wan2.2_i2v_*_noise_14B_fp8_scaled.safetensors` respectively, with
`umt5_xxl_fp8_e4m3fn_scaled.safetensors` and `wan_2.1_vae.safetensors`; the I2V and first/last
frame variants also load `clip_vision_h.safetensors`. Genjutsu and Edit use
`wan2.1_vace_14B_fp16.safetensors`. The still graphs load `flux2-dev.safetensors` or
`qwen-image.safetensors`; `lib/generate/workflows/modelFiles.ts` is the one place to rename them.
LTX-2 loads `ltx-2-dev.safetensors` and HunyuanVideo 1.5 loads
`hunyuan_video_15_t2v_fp8_scaled.safetensors` with `llava_llama3_fp8_scaled.safetensors` and
`hunyuan_video_vae_bf16.safetensors`. Match these names to the deployment's input folders before a
real run; a mismatch fails at `CheckpointLoaderSimple`/`UNETLoader`, not silently.

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
