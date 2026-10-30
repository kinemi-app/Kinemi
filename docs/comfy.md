# Comfy setup

Kinemi renders on ComfyUI. This page covers Comfy Cloud, a local ComfyUI, the model files a local install needs, the smoke test, and what each backend cannot do.

Without `COMFY_URL`, Kinemi runs in demo mode and needs none of this. See [getting started](getting-started.md).

## Pick a backend

| `.env` | Backend |
| --- | --- |
| `COMFY_URL` empty | Demo adapter. Every render is a deterministic SVG poster. |
| `COMFY_URL=https://cloud.comfy.org/api` | Comfy Cloud. |
| `COMFY_URL=http://127.0.0.1:8188` | A local ComfyUI. Any other host works the same way. |

`GENERATION_MODE` can override the choice: `auto` (default) uses ComfyUI when `COMFY_URL` is set, `cloud` requires `COMFY_URL` and answers 503 without it, and `local` always uses the demo generator. The server decides Cloud or local from the host name: only `cloud.comfy.org` counts as Cloud.

`GET /api/status` shows what the server is configured to run against. It never returns a key.

## Comfy Cloud

```bash
COMFY_URL=https://cloud.comfy.org/api
COMFY_API_KEY=your-cloud-key
```

Then run `npm run start`. The `/api` part of the URL is required.

- Make the key at platform.comfy.org under API Keys. It is shown once.
- The server sends the key as `X-API-Key`.
- It reads job status from `/api/job/{id}/status`.
- It fetches results through Cloud's signed `/view` redirect and does not pass the key to the storage host.
- Cloud's free tier refuses `POST /prompt` (403 `FREE_TIER_NOT_ALLOWED`). Renders need a paid plan.

You can test a key in the studio under Settings → Providers → Keys you bring. The check goes through your own Kinemi server, because Cloud does not accept calls from web pages.

## A local ComfyUI

```bash
COMFY_URL=http://127.0.0.1:8188
```

If your ComfyUI sits behind a proxy that wants a Bearer token, add `COMFY_API_KEY`. The server sends it as `Authorization: Bearer`. Leave it empty otherwise.

The local graphs load specific model files and node packs. Install them with the steps below. Then check the deployment:

- `GET /api/deploy/check` (or `POST`) compares what this build's graphs ask for with what your ComfyUI has. It reads `/object_info` once and downloads nothing.
- Settings → Models maps each model file to the name it has on your machine.

## Model files

Three files describe what a deployment needs:

| File | What it holds |
| --- | --- |
| [`build/model-files.md`](../build/model-files.md) | Every registry entry, its model family and the ComfyUI folders it fills. |
| [`data/model-sources.json`](../data/model-sources.json) | The install list: 33 weight files, each pinned to a commit or release, and three node packs pinned by commit. |
| `scripts/comfy-install.mjs` | Checks and installs from that list. |

Three LTX-2 files come from the community repo `Kijai/LTXV2_comfy`. The installer marks them as community sources. Two more files, `rife47.pth` and `depth_anything_v2_vitl.pth`, are fetched by their node packs on first use.

### Check, print, apply

```bash
node scripts/comfy-install.mjs --check --comfy-dir /path/to/ComfyUI
node scripts/comfy-install.mjs --print
node scripts/comfy-install.mjs --apply --yes --comfy-dir /path/to/ComfyUI
```

| Flag | What it does |
| --- | --- |
| `--check` | Lists every entry missing under `--comfy-dir`, and what is unresolved. It uses no network. It compares each file's size with the pinned size. This is the default. |
| `--print` | Prints the `git clone` and download commands and runs nothing. It needs no `--comfy-dir`. |
| `--apply` | Runs the commands. It needs `--comfy-dir` and `--yes`. It is the only mode that clones or downloads. |

`--apply` does not verify a hash after a download. The sha256 values in `data/model-sources.json` are there for a manual check: run `sha256sum` on a file and compare.

To refresh the list from the upstream sources, run `node scripts/verify-model-sources.mjs`. It reads metadata only and downloads no weights.

### Gated weights and `HF_TOKEN`

Four weights sit in gated Hugging Face repos: `ae.safetensors` (FLUX.1-schnell) and the LTX-2.5 transformer, video VAE and text encoder.

1. Accept each licence on huggingface.co.
2. In the shell that runs the installer, run `export HF_TOKEN=...`.
3. Run `node scripts/comfy-install.mjs --apply --yes --comfy-dir <dir>`.

The script does not read `.env`, so do not put the token there. Without a token it skips the four gated files and exits non-zero. Hugging Face hides the sha256 of gated files, so their rows carry none and `--check` can compare only the size.

## Cheap smoke test

`scripts/cloud-smoke.mjs` renders every tool once at its cheapest settings (1 s, on the cheapest model whose graph the server builds). It runs against a running Kinemi server that points at Comfy Cloud or a local ComfyUI.

```bash
node scripts/cloud-smoke.mjs --dry-run                 # print the plan and estimate, send nothing
node scripts/cloud-smoke.mjs --yes --max-credits 12    # render that plan, stop before the cap
```

| Flag | What it does |
| --- | --- |
| `--dry-run` | Prints the plan and its estimate. Nothing is sent. |
| `--yes` | Needed to spend credits. |
| `--max-credits <n>` | Needed for a real run. The run stops before the total passes `n`. |
| `--base <url>` | The Kinemi server to use. Default `http://127.0.0.1:3000`. |

Cinematic is the exception to "cheapest model": it plans one run for every cinematic model. When a model refuses the inputs, the planner retries without the end image, then without the source image. A model that still refuses prints a `refused before submit: <reason>` row instead of being skipped.

Run the dry run first and set the cap from its total. The script prints the plan first, runs exactly that plan, and stops the whole run when a job times out. The estimate and the cap are Kinemi registry credits, not Cloud dollars. Cloud bills GPU time, so watch the Cloud dashboard during your first run.

## What each backend cannot do

### Comfy Cloud

- **Sound effects (`audio/sfx`).** Cloud has no AudioGen node, so the server refuses the request by name before it submits anything.
- **Dubbing into a language other than English.** Refused the same way.
- **Hunyuan 1.5 image-to-video.** This build has no graph for it on any backend.
- **Cancel.** The studio stops watching a job, but the job keeps running, and billing, on Cloud.

Voiceover is not on that list. It renders on Chatterbox on Cloud and on a local ComfyUI, and estimates price it at Chatterbox's 0.04 credits per second. The Voice list in the studio is `Default voice` and `Your cloned voice`, and the audio prompt sent to the server is the script alone.

### A local ComfyUI

Five node classes have no published node pack. `data/model-sources.json` records them as unresolved, and `node scripts/comfy-install.mjs --check` lists them. Until those graphs use real node packs, these features cannot run on a local ComfyUI:

- Sound effects: `AudioGen` and `AudioMatch`.
- Dubbing: `WhisperTranscribe` and `TranslateText`.
- Upscale deflicker: `Deflicker`.

The rest of the upscale path (Real-ESRGAN and RIFE) is not affected.

## Related

- [Getting started](getting-started.md)
- [Architecture](architecture.md): how the adapters talk to ComfyUI.
- [Back to the README](../README.md)
