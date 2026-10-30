# Kinemi

Kinemi is an open, ComfyUI-native film studio. You direct a shot like a film set: camera moves,
re-shoots from a new angle, performance transfer, voice, ads and upscale, all in one studio. Every
render is a real ComfyUI graph that runs on Comfy Cloud or on your own ComfyUI.

Kinemi is our entry for Comfy's [Open Source Higgsfield](https://comfy.org/open-source-higgsfield)
challenge: an open-source rebuild of Higgsfield's creative apps on the Comfy platform, under the MIT
license.

## What you can do

The studio has 16 tools. Each one builds a ComfyUI graph from your settings, and the tool page shows
that graph and its API JSON before you render.

| Tool | What you do |
| --- | --- |
| Cinematic | Build one shot: stack camera moves, pick a body, lens and aperture, set the look. |
| Storyboard | Queue up to eight shots, each with its own prompt, model and duration, then render them in order. |
| Re-shoot | Change the camera angle of a finished image (orbit, tilt, level) and leave the subject alone. |
| Genjutsu | Move a performance from a source clip onto a face or a character card. |
| Presets | Browse the 60 camera moves and the prompt each one is written as. |
| Soul | Turn one sentence into a five-colour palette and a styled still. |
| AI Cast | Build a character with reference images, a locked identity and eight emotions. |
| Edit | Write what should change in a finished clip and re-render it. |
| Audio Studio | Voiceover, voice cloning, dubbing, multi-speaker scenes and sound effects. |
| Marketing Studio | Turn a product photo or URL into an ad, with UGC and tutorial templates and hook variations. |
| Fashion Factory | Swap a garment or a model and keep the drape and lighting. |
| Canvas | Wire models into a pipeline on a node board and save the graph. |
| 3D Previz | Block a shot in 3D, export GLB and clips, then render the block-out as a shot. |
| Supercomputer | Plan a campaign from one brief and run it in batches. |
| Upscale | 4K upscale, frame interpolation to 60 fps and deflicker. |
| Academy | Fourteen short lessons with a figure, a quiz and a glossary. |

Around the tools:

- **Live renders.** The queue shows Comfy's real progress, elapsed and remaining time, and the
  credits a Comfy Cloud run used.
- **Director agent.** A chat that plans shots and calls the studio's tools through Claude Code,
  Codex or OpenRouter. Every render it wants waits for your approval, unless you turn on YOLO in
  Settings.
- **Your library.** Chats, takes and assets live in a local SQLite file on your computer.
- **A command line.** `bin/kinemi.mjs` plans and batch-renders shot lists against a running server.

## Open-weight models

Every model in the registry (`data/models.json`) is open-weight:

| Kind | Models |
| --- | --- |
| Video | Wan 2.2 I2V and T2V (Alibaba), LTX-2 and LTX-2.5 (Lightricks), HunyuanVideo 1.5 (Tencent) |
| Image | FLUX.2 dev and FLUX 3 Image Klein (Black Forest Labs), Qwen-Image (Alibaba) |
| Audio | Chatterbox (Resemble AI), AudioGen Medium (Meta) |
| Video tools | Real-ESRGAN x4, RIFE 4, Depth Anything V2 |

`data/model-sources.json` pins every weight file to a commit or release on its official source, and
`scripts/comfy-install.mjs` installs them into a local ComfyUI.

## Quick start

You need Node.js 22.22.0 or newer.

```bash
npm install
npm run build
npm run start
```

Open http://localhost:3000 for the landing page and http://localhost:3000/app/ for the studio.
Without a ComfyUI the studio runs in demo mode and returns placeholder posters.

To render for real, put a ComfyUI in `.env` (see `.env.example`):

```bash
# Comfy Cloud (needs a paid plan)
COMFY_URL=https://cloud.comfy.org/api
COMFY_API_KEY=your-cloud-key

# or your own ComfyUI
COMFY_URL=http://127.0.0.1:8188
```

`npm run start` checks for 16 GB RAM, 8 GB VRAM and 20 GB free disk first. Set
`KINEMI_SKIP_GUARD=1` to run the app alone on a smaller machine.

## Documentation

- [Getting started](docs/getting-started.md): install, configure, connect a ComfyUI and the chat providers.
- [Studio guide](docs/studio.md): every tool, the queue, the library, the Director agent and settings.
- [Comfy setup](docs/comfy.md): Comfy Cloud, a local ComfyUI, model files and the smoke test.
- [Architecture](docs/architecture.md): how the frontend, API, adapters and storage fit together.
- [Command line](docs/cli.md): `kinemi plan`, `batch`, `run`, `status` and `schedule`.
- [Development](docs/development.md): scripts, hot reload, tests and the guarded start.
- [Model files](build/model-files.md): which ComfyUI folders each model needs.

## Layout

| Folder | What is in it |
| --- | --- |
| `web/` | the frontend: an Astro project with the landing pages and the studio (`web/src/app/`) |
| `app/` | the Next.js API routes and the catch-all route that serves `web/dist` |
| `lib/` | generation adapters, the ComfyUI graph builders, storage and the hardware guard |
| `data/` | the model registry, model sources and presets |
| `bin/` | the `kinemi` command line |
| `scripts/` | the guarded launcher, the ComfyUI installer and the Cloud smoke test |
| `tests/` | API, backend and real-browser test suites |
| `build/` | what a real ComfyUI deployment needs |

## License

[MIT](LICENSE)
