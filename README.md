# Kinemi

Kinemi is an open, ComfyUI-native film studio: camera moves, re-shoots, motion transfer and a shot
list in one place.

## Requirements

- Node.js 20.9.0 or newer for the app, the minimum Next.js 16 declares in its `engines` field.
- Node.js 21 or newer, or Node.js 20.10 with `--experimental-websocket`, for `npm run test:browser`:
  it uses the global `WebSocket`.
- Optional: `ffmpeg` on `PATH` for MP4 export from `/previz`. Without it the route answers 501 and
  the panel saves the WebM recording instead; set `KINEMI_FFMPEG_PATH` to point at a binary outside
  `PATH`.
- For the full Comfy stack: 16 GB RAM, 8 GB VRAM and 20 GB free disk. `npm run start` checks them
  and refuses below them, demo mode included; set `KINEMI_SKIP_GUARD=1` to run the app alone on a
  smaller machine.

## Setup

```bash
npm install
npm run dev
```

The development server answers on http://localhost:3000.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | development server with hot reload |
| `npm run build` | production build |
| `npm run start` | guarded launcher: checks the hardware floors, brings the Comfy stack up, then serves the production build (`-- -p 4000` changes the port) |
| `npm run lint` | ESLint over the repo |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | build, then the API smoke test; no browser needed |
| `npm run test:guard` | the launcher's hardware and teardown checks; no browser needed |
| `npm run test:browser` | build, then the real-browser check of every route |
| `node --test tests/reshoot.e2e.mjs` | build first; reattach, Reset and a stale id on `/reshoot` |
| `node --test tests/references.e2e.mjs` | build first; reference reorder by button and by drag |

## The guarded start

`npm run start` runs `scripts/start.mjs`. It probes RAM, VRAM and free disk, then:

1. Compares them with the floors (16 GB RAM, 8 GB VRAM, 20 GB free disk). Below a floor it prints
   one line naming every shortfall and stops with exit code 1.
2. Starts the Comfy stack with `docker compose up -d` when `KINEMI_COMPOSE_FILE` names a compose
   file.
3. Runs `next start` with the forwarded arguments.

On `SIGINT` or `SIGTERM` it takes the stack down first (`docker compose down --timeout 15`), then
stops Next and its workers. If Next exits by itself, the stack still comes down. VRAM is skipped
when `nvidia-smi` finds no GPU.

| Variable | Default | Meaning |
| --- | --- | --- |
| `KINEMI_MIN_RAM_GB` | `16` | RAM floor |
| `KINEMI_MIN_VRAM_GB` | `8` | VRAM floor, skipped when no GPU is detected |
| `KINEMI_MIN_DISK_GB` | `20` | free disk floor, measured on the working folder |
| `KINEMI_COMPOSE_FILE` | empty | compose file to bring up; empty means app only |
| `KINEMI_DOCKER_CMD` | `docker` | docker command to call |
| `KINEMI_NEXT_CMD` | `next` | Next command to call |
| `KINEMI_SKIP_GUARD` | empty | `1`, `true`, `yes` or `on` skips the probe |

`npm run start -- --check` runs only the hardware probe and exits. The probe reads
`nvidia-smi --query-gpu=memory.total`; `KINEMI_FAKE_RAM_GB`, `KINEMI_FAKE_VRAM_GB` and
`KINEMI_FAKE_DISK_GB` replace the real numbers for a test run.

## The browser check

`npm run test:browser` builds the app, serves the production build on a spare port, and opens `/`,
`/cinematic`, `/storyboard`, `/reshoot`, `/genjutsu` and `/presets` in a real Chromium over the
DevTools protocol. It fails on any console error or uncaught exception, checks that each route heads
its own page, adds a second shot on the storyboard, proves the two render one after the other in list
order, removes one, fills the Cinematic prompt helper, and saves one screenshot per route under
`tests/screenshots/`.

It is separate from `npm test` on purpose: a machine without a browser can still run the API suite.

Two more suites use the same driver and the same spare-port server, and like this one they need a
build first (`npm run build`):

- `node --test tests/reshoot.e2e.mjs` runs Re-shoot end to end, then proves a second load reattaches
  to the stored job, Reset clears it, and a stale id falls back to the empty stage.
- `node --test tests/references.e2e.mjs` uploads three stills to `/cinematic` and reorders them with
  the Earlier/Later buttons and by dragging one card onto another.

The check looks for a browser in this order:

1. `CHROME_BIN`, a Chrome or `chrome-headless-shell` binary.
2. Playwright's browser cache: `~/.cache/ms-playwright` on Linux, `~/Library/Caches/ms-playwright`
   on macOS, `%LOCALAPPDATA%\ms-playwright` on Windows.
3. The usual Chrome install location for the platform.

To point it at a specific browser:

```bash
CHROME_BIN=/usr/bin/chromium npm run test:browser
```

## The kinemi CLI

`bin/kinemi.mjs` is the command-line client for a running server. Run it as
`node bin/kinemi.mjs <command>` (or as `kinemi` once the package is installed or linked). It talks
to `http://localhost:4321` by default; pass `--base` or set `KINEMI_BASE` to point it elsewhere, for
example `--base http://localhost:3000` against `npm run dev`.

`plan` and `batch` are the run and status pair: `plan` asks the server for a shot list, and `batch`
is the run — it submits every shot to `/api/generate`, polls `/api/jobs/:id` and prints each shot's
status as it settles. `--dry-run` validates a plan file without contacting a server.

| Command | What it does |
| --- | --- |
| `kinemi plan --brief "text" [--out plan.json] [--base url]` | posts the brief (at least 12 characters) to `/api/studio/plan` and prints the shots; `--out` writes the shot array as JSON |
| `kinemi batch --plan plan.json [--concurrency 2] [--base url] [--dry-run]` | runs the plan's shots, one status line each; `--concurrency` is capped at 8, and `--dry-run` only validates the file |
| `kinemi schedule add --cron "0 9 * * *" --plan plan.json [--name text] [--base url]` | saves a five-field schedule in `~/.kinemi/schedules.json` and prints its crontab line |
| `kinemi schedule list` | lists the saved schedules |
| `kinemi schedule print` | prints the crontab line for every saved schedule |
| `kinemi schedule remove --id <id>` | removes one schedule |
| `kinemi parity` | runs `scripts/check-parity.mjs` |

```bash
node bin/kinemi.mjs plan --brief "a night drive through Tokyo in the rain" --out plan.json
node bin/kinemi.mjs batch --plan plan.json --dry-run
node bin/kinemi.mjs batch --plan plan.json --concurrency 2
node bin/kinemi.mjs schedule add --cron "0 9 * * *" --plan plan.json --name morning
```

A failed shot does not stop the others, and `batch` exits with code 1 if any shot failed; each job
is given two minutes before it is reported as timed out. `schedule` only writes the file and prints
the line: nothing is installed into your crontab, so add that line yourself. `schedule` and `parity`
work without a server.

## Demo mode

Without `COMFY_URL` every generation runs through the demo adapter and returns a deterministic SVG
poster. `COMFY_API_KEY` is only for deployments that require auth. To talk to a real ComfyUI:

```bash
COMFY_URL=http://127.0.0.1:8188 COMFY_API_KEY=your-key npm run start
```

`build/model-files.md` maps every registry entry to its model family and the ComfyUI folders a real
deployment has to fill.

## Layout

- `app/`: App Router pages, API routes and the global tokens.
- `components/`: UI primitives, the shell, the five flows and the job polling hook.
- `lib/`: shared types, preset and model loaders, cost helpers, the storyboard queue, generation
  adapters and the hardware guard.
- `data/`: model registry and seed presets.
- `bin/`: the `kinemi` command line: `plan`, `batch`, `schedule` and `parity`.
- `scripts/`: the guarded launcher.
- `tests/`: API smoke test, launcher checks, browser checks and their shared helpers.
- `build/`: what a real Comfy deployment needs.
