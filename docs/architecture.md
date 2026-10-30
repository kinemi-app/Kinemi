# Architecture

This page shows how the pieces of Kinemi fit together: the frontend, the server, the render adapters, the stored data and the bridge to Claude Code and Codex.

## The big picture

Kinemi is one Next.js server that also serves a static frontend.

- `web/` is an Astro project. It holds the landing page and the studio, which is one Preact island at `/app/`. `npm run build` turns it into `web/dist`.
- Next serves `web/dist` through the catch-all route `app/[[...path]]/route.ts`, which calls `serveWeb` in `lib/web/static.ts`. It sets the content type, compresses text and answers HEAD requests.
- Routes under `app/api/` are more specific than the catch-all, so they win. Everything else is a file in `web/dist`.

```text
browser
  |  pages (/, /app/)          API calls (/api/...)
  v                            v
Next server (app/)  -- catch-all --> web/dist (Astro build)
  |
  +-- app/api/*  --> lib/generate (demo.ts or comfy.ts)
  |                  lib/chats, lib/library (SQLite)
  |                  app/api/local/* --> web/server/runner.mjs --> claude, codex
  v
Comfy Cloud or your own ComfyUI
```

## The API

The table lists the routes under `app/api/`. All of them answer JSON unless noted.

| Route | Methods | What it does |
| --- | --- | --- |
| `/api/status` | GET | Where this server renders. Never returns a key. |
| `/api/models` | GET | The model registry and each mode's default model. |
| `/api/generate` | POST | Start a render job. |
| `/api/generate/graph` | POST | The ComfyUI graph a request would run, without a job. |
| `/api/jobs/:id` | GET | Status, progress and result of one job. |
| `/api/studio/plan` | POST | Turn a brief into a shot list. |
| `/api/assets` | POST | Store one uploaded file. |
| `/api/assets/from-url` | POST | Copy one ComfyUI output into the input folder. |
| `/api/import-image` | POST | Fetch a product photo from a URL and store it. |
| `/api/files/:id` | GET, PUT, DELETE | A stored file's bytes. |
| `/api/library` | GET | Assets, folders and tags. |
| `/api/library/:kind/:id` | PUT, DELETE | Save or remove one library record. |
| `/api/chats` | GET | Every chat, newest first. |
| `/api/chats/:id` | PUT, DELETE | Save or remove one chat. |
| `/api/comfy/view` | GET | Relay a media file from ComfyUI to the browser. |
| `/api/export` | POST | Turn a WebM clip into MP4 with ffmpeg. |
| `/api/previz/render` | POST | Render a 3D Previz block-out as a shot. |
| `/api/deploy/check` | GET, POST | Check that a ComfyUI deployment has what Kinemi needs. |
| `/api/collab/:room` | GET, POST | A shared room for collaboration. |
| `/api/local/status` | GET | Are Claude Code and Codex on this computer? |
| `/api/local/chat` | POST | One chat turn through Claude Code or Codex. |
| `/api/local/comfycloud` | GET | Check a Comfy Cloud key from the server. |

## The frontend calls the server in one place

`web/src/app/backend.ts` is the only module in the studio that calls the server. Tools, the render queue and the library go through it. The server decides where renders run, so the frontend never needs to know.

In development, Astro runs on port 4321 and proxies `/api` to Next. See [development](development.md).

## Generation adapters

`app/api/generate/route.ts` validates a request and hands it to a generator. Both generators in `lib/generate` share one interface, `submit` and `poll`, so the route does not know which one it holds.

- **`demo.ts`** needs no GPU. It returns a deterministic SVG poster after a short delay, so the progress bar has something to show.
- **`comfy.ts`** builds a ComfyUI graph from `lib/generate/workflows`, submits it and polls for the result. It picks the dialect from the host in `COMFY_URL`. The host `cloud.comfy.org` means Comfy Cloud, which authenticates with an `x-api-key` header. Any other host is a local ComfyUI.

If `COMFY_URL` is not set, or `GENERATION_MODE` is `local`, the demo adapter runs. See [Comfy setup](comfy.md) for the variables.

## Jobs and live progress

- `lib/generate/store.ts` keeps jobs in memory. It holds the 50 newest and drops the oldest first. A restart clears them.
- The studio polls `/api/jobs/:id` about once a second. The CLI polls about every 0.7 seconds.
- For ComfyUI runs, `comfy-progress-feed.ts` keeps one WebSocket per deployment. `comfy-progress.ts` turns each message into a state with the phase, the step, a progress fraction and the time left. The job carries it as `live`.
- Time left appears only when the sampler steps give a real rate. Kinemi does not guess one.
- Demo jobs derive progress from elapsed time, so they carry no `live` report.

## Stored data

The chat, library and uploaded files live in one SQLite file, `~/.kinemi/kinemi.sqlite`. Set `KINEMI_DB` in `.env` to use another path. `lib/chats/store.ts` opens it, and `lib/library/store.ts` reads and writes the library. Both use the same connection.

| Table | Holds |
| --- | --- |
| `chats` | One row per chat: title, timestamps and the messages as JSON. |
| `library` | Assets, folders and tags, keyed by kind and id, with the record as JSON. |
| `files` | Uploaded and imported files: id, type, size and the bytes. |

The database runs in WAL mode. Kinemi refuses to open a file written by a newer schema version.

## The local CLI bridge

The chat can use Claude Code or Codex if they are installed on your computer.

- `app/api/local/status` and `app/api/local/chat` call `web/server/runner.mjs`. It runs the CLI in an empty folder, one call at a time. Claude Code runs with its tools off. Codex runs in its read-only sandbox.
- The bridge runs commands on your computer, so it works only on loopback. `scripts/start.mjs` sets `KINEMI_LOCAL_CLI_BOUND=1` only when Next listens on `127.0.0.1` alone. `app/api/local/guard.ts` then also checks the `Host` and `Origin` headers, which blocks other websites and DNS rebinding.
- Any other setup answers `offline`. See the launcher variables in [development](development.md).
- `web/server/local.mjs` is a small standalone server with the same checks, for running the Astro build without Next.

## Folder layout

| Folder | What is in it |
| --- | --- |
| `web/` | The Astro frontend: landing, studio, `web/server/` for the CLI bridge. |
| `app/` | Next routes: the catch-all and `app/api/`. |
| `lib/` | Server code: `generate/`, `chats/`, `library/`, `studio/`, `runtime/`, `config/`, `web/`. |
| `data/` | The model registry, model sources, presets and canvas templates. |
| `bin/` | The `kinemi` command line, see [the CLI](cli.md). |
| `scripts/` | The guarded launcher and the ComfyUI install scripts. |
| `tests/` | API, backend, browser and launcher suites. |
| `build/` | `model-files.md`, which maps each registry model to its ComfyUI files. |

## Related

- [Getting started](getting-started.md)
- [Studio guide](studio.md)
- [Comfy setup](comfy.md)
- [Development](development.md)
- [Back to the README](../README.md)
