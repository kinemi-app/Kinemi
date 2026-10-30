# Development

This page is for people who change Kinemi. It lists the npm scripts, shows how to get hot reload, and explains the browser suite and the guarded start.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm install` | Installs the root packages. Its `postinstall` runs `npm --prefix web ci`, which installs the frontend. |
| `npm run dev` | Next development server. The API reloads. Pages come from the last `web/dist` build. |
| `npm run dev:web` | Astro development server for `web/`. It proxies `/api` to Next. |
| `npm run build` | Builds `web/` with Astro, then builds Next. |
| `npm run start` | The guarded launcher, `scripts/start.mjs`. It serves the production build. |
| `npm run lint` | ESLint over the repo. `web/` is excluded. |
| `npm run typecheck` | TypeScript with no emit, then `astro check` in `web/`. |
| `npm test` | The API smoke test and every `tests/*.backend.mjs` suite. |
| `npm run test:guard` | The launcher's hardware and teardown checks. |
| `npm run test:browser` | Every `tests/*.browser.mjs` suite in a real browser. |

`pretest` and `pretest:browser` run `npm run build` first, so both test scripts test a fresh build. `npm test` and `npm run test:guard` need no browser.

## Hot reload

Use two terminals.

```bash
npm run dev       # Next and the API on :3000
npm run dev:web   # Astro on :4321
```

Open http://localhost:4321. Astro proxies `/api` to `http://127.0.0.1:3000`. If Next runs somewhere else, set `KINEMI_API`:

```bash
KINEMI_API=http://127.0.0.1:4000 npm run dev:web
```

The proxy is set up in `web/astro.config.mjs`. If Next is not running, the proxy answers with a JSON `offline` error instead of a bare 502.

`npm run dev` alone serves the last `web/dist` build, so run `npm run build` once before it.

## The browser suite

`npm run test:browser` builds the app, serves the production build in demo mode on a spare port and drives a real Chromium over the DevTools protocol. It adds no npm dependency. The driver is `tests/lib/browser.mjs`.

It looks for a browser in this order:

1. `CHROME_BIN`, a Chrome or `chrome-headless-shell` binary.
2. Playwright's cache: `~/.cache/ms-playwright` on Linux, `~/Library/Caches/ms-playwright` on macOS, `%LOCALAPPDATA%\ms-playwright` on Windows.
3. The usual Chrome install location for the platform.

To use a specific browser:

```bash
CHROME_BIN=/usr/bin/chromium npm run test:browser
```

The suite fails on any console error or uncaught exception. It saves screenshots under `tests/screenshots/`. It is separate from `npm test` on purpose, so a machine without a browser can still run the API suites.

## The guarded start

`npm run start` runs `scripts/start.mjs`. It probes RAM, VRAM and free disk, then does three things.

1. **Checks the floors.** The defaults are 16 GB RAM, 8 GB VRAM and 20 GB free disk. Below a floor, it prints one line that names every shortfall and exits with code 1. VRAM is skipped when `nvidia-smi` finds no GPU.
2. **Starts the Comfy stack.** If `KINEMI_COMPOSE_FILE` names a compose file, it runs `docker compose up -d`. Without it, only the app starts.
3. **Runs `next start`.** Extra arguments pass through, for example `npm run start -- -p 4000`. With no `-H`, the launcher adds `-H 127.0.0.1`. Next then answers this computer only, and the Claude Code and Codex bridge is on.

To serve other devices, set `KINEMI_LOCAL_CLI=off`, or pass `-- -H 0.0.0.0`. Either turns the bridge off, because the bridge runs commands on your computer. See [architecture](architecture.md) for how the guard works.

On `SIGINT` or `SIGTERM`, the launcher takes the stack down first with `docker compose down --timeout 15`. Then it stops Next and its workers. If Next exits by itself, the stack still comes down.

`npm run start -- --check` runs only the hardware probe and exits.

### Launcher variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `KINEMI_MIN_RAM_GB` | `16` | RAM floor. |
| `KINEMI_MIN_VRAM_GB` | `8` | VRAM floor. Skipped when no GPU is found. |
| `KINEMI_MIN_DISK_GB` | `20` | Free disk floor, measured on the working folder. |
| `KINEMI_COMPOSE_FILE` | empty | Compose file to bring up. Empty means app only. |
| `KINEMI_DOCKER_CMD` | `docker` | Docker command to call. |
| `KINEMI_NEXT_CMD` | `next` | Next command to call. |
| `KINEMI_SKIP_GUARD` | empty | `1`, `true`, `yes` or `on` skips the hardware probe. |
| `KINEMI_LOCAL_CLI` | empty | `off` keeps Next on every interface and turns the CLI bridge off. |
| `KINEMI_CLAUDE_BIN` | `claude` | Claude Code command the chat bridge calls. |
| `KINEMI_CODEX_BIN` | `codex` | Codex command the chat bridge calls. |
| `KINEMI_FAKE_RAM_GB` | empty | Replaces the measured RAM, for tests. |
| `KINEMI_FAKE_VRAM_GB` | empty | Replaces the measured VRAM, for tests. |
| `KINEMI_FAKE_DISK_GB` | empty | Replaces the measured free disk, for tests. |

The launcher sets `KINEMI_LOCAL_CLI_BOUND` itself. Never put it in `.env`.

The `.env` file is read by the launcher. `GENERATION_MODE` is `auto`, `cloud` or `local`, and the default is `auto`. See [Comfy setup](comfy.md) for the render variables.

## Related

- [Getting started](getting-started.md)
- [Studio guide](studio.md)
- [Architecture](architecture.md)
- [The CLI](cli.md)
- [Back to the README](../README.md)
