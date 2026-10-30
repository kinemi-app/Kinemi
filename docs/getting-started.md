# Getting started

This page takes you from a fresh clone to a running studio. You can try it in demo mode first, then connect Comfy Cloud or your own ComfyUI.

## Requirements

- Node.js 22.22.0 or newer.
- Optional: `ffmpeg` on your `PATH`. The studio uses it to turn a WebM clip into MP4 (`POST /api/export`). Without it that route answers 501. Set `KINEMI_FFMPEG_PATH` if the binary lives outside `PATH`.
- Hardware floors for the full Comfy stack: 16 GB RAM, 8 GB VRAM and 20 GB free disk. `npm run start` checks them and refuses to start below them, demo mode included. On a smaller machine, set `KINEMI_SKIP_GUARD=1` to run the app alone. See [development](development.md) for the guard and its variables.

## Install and start

```bash
npm install
npm run build
npm run start
```

`npm install` also installs the frontend in `web/`: its `postinstall` runs `npm --prefix web ci`. `npm run build` builds `web/` first, then Next.

The server answers on http://localhost:3000:

| Path | What you get |
| --- | --- |
| `/` | the landing page |
| `/app/` | the studio |
| `/api/` | the API |

To use another port, run `npm run start -- -p 4000`.

## Configure with `.env`

Copy the example file and edit it:

```bash
cp .env.example .env
```

`npm run start` reads `.env` in the repo root. A variable already set in your shell wins over the file. Leave a variable empty to keep its default.

| Variable | What it does |
| --- | --- |
| `COMFY_URL` | ComfyUI endpoint. Empty means demo mode. |
| `COMFY_API_KEY` | Comfy Cloud API key, or a Bearer token for an authenticating proxy. |
| `GENERATION_MODE` | `auto` (default) uses ComfyUI when `COMFY_URL` is set. `cloud` requires it. `local` always uses the demo generator. |
| `KINEMI_DB` | SQLite file for chats, assets and imported files. Empty means `~/.kinemi/kinemi.sqlite`. |
| `KINEMI_LOCAL_CLI` | `off` serves every interface and turns the Claude Code / Codex bridge off. |
| `LLM_URL`, `LLM_API_KEY`, `LLM_MODEL` | An OpenAI-compatible endpoint for the shot-list planner. `LLM_URL` and `LLM_MODEL` are both needed. |
| `KINEMI_TTS_CMD` | A command that makes speech outside ComfyUI. Empty means the demo tone. |
| `KINEMI_FFMPEG_PATH` | The ffmpeg binary for MP4 export. |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook for connector notifications. |
| `NOTION_TOKEN`, `NOTION_DATABASE_ID` | Notion connector. |
| `GDRIVE_TOKEN` | Google Drive connector. |

`HF_TOKEN` is not in this list on purpose. The model installer reads it from your shell, never from `.env`. See [Comfy setup](comfy.md).

## Demo mode

With `COMFY_URL` empty, every generation runs through the demo adapter. It returns a deterministic SVG poster after a few seconds, so you can click through every tool, the queue and the library without a GPU or an account.

## Connect Comfy Cloud

Put these two lines in `.env`, then restart:

```bash
COMFY_URL=https://cloud.comfy.org/api
COMFY_API_KEY=your-cloud-key
```

The `/api` part of the URL is required. Make a key at platform.comfy.org under API Keys. Cloud's free tier refuses renders, so you need a paid plan. More detail is in [Comfy setup](comfy.md).

## Connect a local ComfyUI

```bash
COMFY_URL=http://127.0.0.1:8188
```

Add `COMFY_API_KEY` only if your ComfyUI sits behind a proxy that wants a Bearer token. Your ComfyUI also needs the model files and node packs the graphs load. [Comfy setup](comfy.md) shows how to check and install them.

You can also set the ComfyUI address in the studio under Settings → Providers. The server's `.env` still decides where renders run. Keys typed in the browser stay in that browser.

## Chat providers

The studio chat can run on four assistants. Pick one under Settings → Providers.

| Assistant | What you need |
| --- | --- |
| Built-in | Nothing. It is the fallback if another provider cannot answer. |
| OpenRouter | An API key from openrouter.ai/keys. Paste it in Settings → Providers. It stays in your browser. |
| Claude Code | Claude Code installed and signed in on the same computer (`npm install -g @anthropic-ai/claude-code`, then run `claude` once). |
| Codex | Codex CLI installed and signed in on the same computer (`npm install -g @openai/codex`, then `codex login`). |

Claude Code and Codex run through a bridge on your own computer. The bridge works only while the server listens on `127.0.0.1`, which is what `npm run start` does by default. Serving other devices (`KINEMI_LOCAL_CLI=off` or `-- -H 0.0.0.0`) turns the bridge off, because it runs commands on your machine. Set `KINEMI_CLAUDE_BIN` or `KINEMI_CODEX_BIN` if a CLI is not on your `PATH`. [Architecture](architecture.md) explains the bridge.

## Where your data lives

| What | Where |
| --- | --- |
| Chats, the asset library and imported files | `~/.kinemi/kinemi.sqlite`, or the file named by `KINEMI_DB` |
| CLI schedules | `~/.kinemi/schedules.json` |
| Provider keys typed in the studio | your browser only |

Without `KINEMI_DB`, the server stores and serves chats only for requests that come from this computer. If other people reach your server, set `KINEMI_DB`. Every visitor then shares the chats in that file.

## Next steps

- [Studio guide](studio.md): what each tool does.
- [Comfy setup](comfy.md): Cloud, local ComfyUI and model files.
- [CLI](cli.md): plan and run shot lists from a terminal.
- [Development](development.md): scripts, hot reload and tests.
- [Back to the README](../README.md).
