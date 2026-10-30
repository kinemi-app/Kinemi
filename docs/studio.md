# Studio guide

The studio lives at `/app/`. This page covers its tools, the models behind them, takes, the render queue, the asset library, chats, the Director agent and Settings → Providers.

## The 16 tools

Each tool has its own page at `/app/tools/<slug>/`. A tool turns its form into one request for the server. The "Mode" column is the server mode the tool renders in (`web/src/app/data/backend-map.ts`). Academy only teaches, so it has none.

| Tool | Page | Mode | Makes | What you do |
| --- | --- | --- | --- | --- |
| Cinematic | `cinematic` | cinematic | video | Build one shot: stack camera moves, pick a body, lens and aperture, set the look. |
| Storyboard | `storyboard` | cinematic | board | Queue up to eight shots, each with its own prompt, model and duration, then render the list in order. |
| Re-shoot | `re-shoot` | reshoot | still | Change the camera angle of a finished image (orbit, tilt, level) and leave the subject alone. |
| Genjutsu | `genjutsu` | genjutsu | video | Move a performance from a source clip onto a face or a character card. |
| Presets | `presets` | cinematic | video | Browse the 60 camera moves and the prompt each one is written as. |
| Soul | `soul` | soul | palette | Turn one sentence into a five-colour palette, pick a Soul 2.0 preset, then render the still. |
| AI Cast | `ai-cast` | soul | character | Build a character with reference images, a locked identity and eight emotions. |
| Edit | `edit` | edit | video | Write what should change in a finished clip and re-render it. |
| Academy | `academy` | none | video | Fourteen short lessons with a figure, a quiz and a glossary. |
| Audio Studio | `audio-studio` | audio | audio | Voiceover, voice cloning, dubbing, multi-speaker scenes and sound effects. |
| Marketing Studio | `marketing-studio` | ads | video | Turn a product photo or URL into an ad, with UGC and tutorial templates and hook variations. |
| Fashion Factory | `fashion-factory` | fashion | still | Swap a garment or a model and keep the drape and lighting. |
| Canvas | `canvas` | cinematic | video | Wire models into a pipeline on a node board and save the graph. |
| 3D Previz | `3d-previz` | cinematic | previz | Block a shot in 3D, export GLB and clips, then render the block-out as a shot. |
| Supercomputer | `supercomputer` | cinematic | board | Plan a campaign from one brief and run it in batches. |
| Upscale | `upscale` | upscale | video | 4K upscale, frame interpolation to 60 fps and deflicker. |

Every tool page has the same layout: controls, a monitor, the prompt the tool writes, the cost, and the takes. The "Comfy graph" and "API JSON" tabs show the exact ComfyUI graph the server will run for your current settings.

## Models

The server registry, `data/models.json`, is the source of truth. A tool renders on the registry model its pick resolves to. If the pick does not serve the tool's mode, the mode's default model runs instead.

| Model | Vendor | Kind | Modes | Max length | Credits/s |
| --- | --- | --- | --- | --- | --- |
| Wan 2.2 I2V | Alibaba | video | cinematic, reshoot, genjutsu, edit, ads | 5 s | 0.8 |
| Wan 2.2 T2V | Alibaba | video | cinematic, ads | 5 s | 0.6 |
| LTX-2 | Lightricks | video | cinematic | 10 s | 1.2 |
| LTX-2.5 | Lightricks | video | cinematic | 10 s | 1.4 |
| HunyuanVideo 1.5 | Tencent | video | cinematic | 8 s | 1.0 |
| FLUX.2 dev | Black Forest Labs | image | reshoot, soul, ads, fashion | 1 image | 0.3 |
| FLUX 3 Image Klein | Black Forest Labs | image | soul | 1 image | 0.35 |
| Qwen-Image | Alibaba | image | reshoot, soul, ads, fashion | 1 image | 0.25 |
| Chatterbox | Resemble AI | audio | audio | 30 s | 0.04 |
| AudioGen Medium | Meta | audio | audio | 10 s | 0.05 |
| Real-ESRGAN x4 | XPixel | video | upscale | 60 s | 0.05 |
| RIFE 4 | Practical-RIFE | video | upscale | 60 s | 0.03 |
| Depth Anything V2 | ByteDance | image | depth | 1 image | 0.02 |

Depth Anything V2 is a preprocessor for the other tools. It does not appear as a tool of its own. The studio clamps a requested length to the model's maximum before it sends the job.

Licences differ per model, and the model card is the final word. Three limits are worth knowing before you use the output for work:

- FLUX.2 dev is non-commercial to run. The stills it makes may be used commercially.
- LTX-2 and LTX-2.5 are free for companies under $10M a year in revenue.
- HunyuanVideo 1.5 is not licensed for use in the EU, the UK or South Korea.

Settings → Models lists default models, their licences and the model file names ComfyUI loads.

## Takes

A take is one render. When you press Render, the studio sends one job per take and saves each result to your library. Under the monitor, the Takes strip shows the last ten renders of that tool, numbered `T01`, `T02` and so on. Click a take to look at it. The newest has the highest number.

Two places let you ask for several takes at once. Supercomputer has an axis switch (Places, Looks, Takes) and a slider for 2 to 6 takes, which differ only by seed. Marketing Studio has a "Hook variations" slider from 1 to 6.

## The render queue

The queue button opens a panel with every job: what is rendering, what waits, what just finished.

- **Progress.** A rendering job shows its percentage and a bar. When the server reports more, the line also shows time elapsed, time left and the step (for example `step 12/30`). A job waiting in the server's own queue shows its wait message and the time elapsed.
- **Time left.** It appears only when the server can compute it from the sampler steps of the run. Otherwise the line shows nothing for it.
- **Credits.** A finished job shows its GPU time and, when the backend reports it, its credits.
- **Demo mode.** The demo backend gives no report, so you see the percentage only.
- **Cancel.** The X button stops the studio from watching a job. On Comfy Cloud the job keeps running, and billing, on Cloud.
- **Failures.** A failed job shows the server's error in the queue and on the chat card.
- **Footer.** It names where renders run, and "Clear finished" removes done, cancelled and failed jobs.

Before you render, the tool page shows an estimate of runtime and credits. Credits come from the registry rate times the length and resolution. They are Kinemi registry credits, not a Cloud bill.

## The assets library

Everything you render or import lands in the library (sidebar → Library, or the Renders item). Asset kinds are video, still, audio, palette, board, character and 3D previz.

- **Scopes.** All assets, Favourites, This week, Unsorted and Trash.
- **Folders and tags.** Make folders in the sidebar, tag assets, and drag assets onto a folder, Favourites or Trash.
- **Filters.** Search by text, and filter by kind, by the tool that made the asset, and by tag.
- **Detail drawer.** Open an asset to see its details. The asset menu also offers favourite, tag, move to a folder, download and trash.
- **Import.** Bring in your own files. The server checks the real file type from its bytes, not its name. An uploaded file may be up to 50 MB.
- **Storage.** The library is kept in the SQLite file described in [getting started](getting-started.md).

## Chats

The chat is where you describe a shot in plain words. It sets up the right tool with the right values and shows the result as a card. Past chats appear in the sidebar under History and are saved in the same SQLite file as the library. You can switch chats and carry on later.

## The Director agent and approvals

The chat's assistant acts as an assistant director. It picks one of the 16 tools, fills in the settings that tool's form takes, and says what the shot will cost and look like. Every value it sets is checked against the tool's own form, so it cannot go past what the form offers.

Setting up a shot never renders on its own. When the agent asks to render, a card appears: "Kinemi set this up. Nothing has run yet." You choose:

- **Approve** starts the render.
- **Not now** keeps the shot set up and runs nothing.

### YOLO

Settings → Providers has a switch named "YOLO: run without asking".

- **Off (default).** A render the chat asks for waits for your Approve click.
- **On.** That render starts at once and spends credits.

Turn it on only when you want the chat to spend credits without asking.

## Settings

Settings has eight sections, each a page at `/app/settings/<id>/`.

| Section | What is in it |
| --- | --- |
| Account | Your name and how you sign in. |
| Providers | Keys you bring, where renders run, who answers in the chat. |
| Models | Default models, their licences and the model files ComfyUI loads. |
| Rendering | Resolution, frame rate, negative prompts, file names and a spending limit. |
| Interface | Motion, the 3D models, the sidebar and keyboard shortcuts. |
| Notifications | How Kinemi tells you a render landed. |
| Data & privacy | What Kinemi keeps, backups and starting over. |
| Legal & about | Version, policies, licences and contact. |

### Settings → Providers

This page has three cards.

**Keys you bring.** Paste your Comfy Cloud key (made at platform.comfy.org, needs a paid plan) and your OpenRouter key (made at openrouter.ai/keys). Each key has a Test button. Keys stay in this browser and are never part of an export. "Remember keys on this device" off means they are forgotten when you close the tab. Testing a Cloud key needs the server on your own computer, because Cloud does not take calls from web pages.

**Renders run on.** Shows where this server renders. Choose Comfy Cloud or Your own GPU, enter the ComfyUI address (usually `http://127.0.0.1:8188`) and press Save and test. The server's `.env` decides where renders actually run, so keys typed here do not change that. "Parallel renders" (1 to 4) sets how many cells of a Supercomputer batch render at once. One local ComfyUI works through its queue one job at a time.

**The chat runs on.** Choose Built-in, OpenRouter, Claude Code or Codex. For OpenRouter you can search the model list or type a model id. Auto lets OpenRouter pick a model for each message. Claude Code and Codex show up only when Kinemi runs on your own computer. Each shows its install and login command and lets you pick a model and reasoning effort. The YOLO switch sits at the bottom of this card.

## Related

- [Getting started](getting-started.md)
- [Comfy setup](comfy.md)
- [Architecture](architecture.md)
- [Back to the README](../README.md)
