# Kinemi landing site and studio

One Astro project with:

- **The landing page** at `/`. The layout follows the Voxa reference design; colours, type, icons,
  copy and the 3D hand are Kinemi's own.
- **The studio dashboard** at `/app/`: chat with the assistant, use any of the 16 tools on its own,
  keep every render in the asset store, and set everything up in Settings. See
  [The studio dashboard](#the-studio-dashboard) below.
- **Accounts and policies**: Sign in, Sign up and password pages, the Imprint, Privacy Policy,
  Terms, Acceptable Use Policy, Cookies and storage, Licenses, and a 404 page.

The same code runs two ways, decided when it is built:

| | **On your own computer** (the open-source release) | **On the web** |
|---|---|---|
| Set when building | nothing | the Supabase URL and key ([Publish the web version](#publish-the-web-version)) |
| Accounts | none, no account screens | Sign in, Sign up, sync across devices |
| Guests | everyone | allowed by default; `PUBLIC_GUEST_MODE=off` makes signing in required |
| Chat providers | built-in rules, OpenRouter, **Claude Code and Codex on this computer** | built-in rules, OpenRouter |

## Run it on your own computer

```sh
npm install
npm start         # builds, then serves the studio on http://localhost:4321
```

Needs Node 22.22 or newer (Astro 7). `npm start` runs `server/local.mjs`, a small server that
listens on 127.0.0.1 only. Besides the site, it lets the chat use the Claude Code or Codex CLI
installed on your computer, and it checks Comfy Cloud keys (Comfy Cloud doesn't accept calls from
web pages, a server can make them).

To render on your own GPU, start ComfyUI so the studio's page may call it, then enter its address
in Settings → Providers:

```sh
python main.py --enable-cors-header http://localhost:4321
```

Settings shows the exact command for the address you opened Kinemi on.

While working on the code:

```sh
npm run dev       # http://localhost:4321, with hot reload
npm run bridge    # in a second terminal: the Claude Code and Codex API for the dev server (port 4322)
npm run build     # static site in dist/
npm run check     # type check
```

## Publish the web version

The web version is a static site plus a Supabase project for accounts. Guests keep their work in
their own browser; signed-in users' work is saved to Supabase, in the EU.

1. **Create a Supabase project** at supabase.com and pick **Frankfurt (eu-central-1)** as the region.
2. **Create the tables:** SQL Editor → New query → paste `supabase/schema.sql` → Run. It makes the
   `studio_items` table, the `studio-files` bucket for imported images and clips, the access rules
   that keep every user to their own rows and files, and `delete_my_account()` for Settings → Account.
   It is safe to run again.
3. **Set the addresses:** Authentication → URL Configuration. Site URL: `https://your-domain`.
   Redirect URLs: add `https://your-domain/**` (the email links land on `/app/`,
   `/reset-password/` and `/app/settings/account/`).
4. **Send the emails from your own server:** Authentication → Emails → SMTP Settings. Supabase's
   built-in sender is only for trying things out: it sends a few emails an hour, and only to your
   project team. Name the email provider in `src/data/legal.ts`.
5. **Optional sign-in buttons:** switch on Google, GitHub, Apple, Discord or GitLab in Supabase's
   Authentication settings, then list them in `PUBLIC_AUTH_PROVIDERS`.
6. **Sign Supabase's Data Processing Agreement** (GDPR Art. 28). Supabase processes your users'
   data for you; the Privacy Policy says so.
7. **Fill in `src/data/legal.ts`** (see [Policies](#policies)).
8. **Build on your host** (Netlify, Vercel, Cloudflare Pages…): build command `npm run build`,
   output folder `dist/`, and these variables:

| Variable | Value |
|---|---|
| `PUBLIC_SUPABASE_URL` | Your project's URL, `https://<project>.supabase.co` (the dashboard's Connect button shows it) |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key (`sb_publishable_…`) from Project Settings → API Keys. An older anon key works as `PUBLIC_SUPABASE_ANON_KEY`. Both are meant for the browser. |
| `PUBLIC_GUEST_MODE` | `on` (default): people may use the studio as guests. `off`: everyone signs in first. |
| `PUBLIC_AUTH_PROVIDERS` | Optional: `google,github`… |
| `SITE_URL` | `https://your-domain`, for canonical and social links |
| `PUBLIC_APP_URL` | Optional: where the landing page's studio links point, if the studio is hosted elsewhere |
| `PUBLIC_COMFY_CLOUD_URL` | Optional: a proxy of your own in front of Comfy Cloud (see below) |

`.env.example` lists the same variables; copy it to `.env` to build with them locally. With
`PUBLIC_GUEST_MODE=off` but no Supabase values, the build warns and keeps guests on, so nobody is
locked out. Builds without the Supabase values leave the account code and supabase-js out entirely.

**Comfy Cloud on the web.** Comfy Cloud refuses calls from web pages, so on the web version the
browser can't check a Comfy Cloud key; Settings says so and keeps the key. Once renders run on
Comfy Cloud for real, the web version needs a small proxy (one serverless function that forwards
`/api/*` with the user's `X-API-Key`); point `PUBLIC_COMFY_CLOUD_URL` at it. On your own computer,
`server/local.mjs` already does this for the key check.

Files in `dist/_astro/` have content hashes in their names and can be cached forever.
`public/_headers` sets that up, with basic security headers, on Netlify and Cloudflare Pages.

### Where data lives

| What | Guest, or on your own computer | Signed in |
|---|---|---|
| The studio: assets, folders, tags, chats, cast, settings | this browser (`localStorage`, `kinemi.studio.v1`) | Supabase `studio_items`, with a copy per account in this browser (`kinemi.studio.v1:<user id>`) |
| Imported images and clips | this browser (IndexedDB `kinemi-files`) | Supabase Storage `studio-files/<user id>/`, cached in IndexedDB |
| Keys: Comfy Cloud, OpenRouter | this browser only (`kinemi.secrets.v1`; tab only when “Remember keys” is off) | the same: keys never reach the account |
| Device settings: where renders run, chat provider, sidebar, motion, notifications | this browser (`kinemi.device.v1`) | the same, never synced |

A guest who creates an account is offered to bring the browser's studio along. Settings →
Data & privacy lists every entry, and the Cookies page shows the same table.

## The app pictures

The eight pictures in `src/assets/screens/` were captured from a running studio by
`web/tools/screens.mjs`. Start the server, then re-run it after a UI change or before a release:

```
npm start                              # one terminal
cd web && node tools/screens.mjs       # another; http://127.0.0.1:3000 by default
```

It drives the browser through `tests/lib/browser.mjs`, so it adds no npm package. The three app
slots are screenshots of the studio; the five render slots are stills the server returns from
`POST /api/generate` — the built-in generator's while `COMFY_URL` is unset, real ComfyUI frames
once it is set. The build converts each file to AVIF and WebP.

To replace one by hand, save an image as `src/assets/screens/<name>.png` (`.jpg`, `.webp` and
`.avif` also work) and rebuild. A slot without a file falls back to a labeled, empty viewfinder.

| Slot | Where it appears | Size |
|---|---|---|
| `studio-desktop` | Open models section, inside the browser window | 2560 × 1600 |
| `render-1` … `render-4` | Open models section, the floating cards | 1280 × 720 |
| `phone-cinematic` | Camera language section, phone screen | 1179 × 2556 |
| `phone-anywhere` | Render wherever you are, left phone (the chat) | 1179 × 2556 |
| `render-anywhere` | Render wherever you are, render inside the right phone | 1280 × 720 |

Labels, sizes and alt texts live in `src/data/shots.ts`.

## Copy, links and pricing

| File | What it holds |
|---|---|
| `src/data/site.ts` | Page title and description, nav links, and the links into the studio. They point at the bundled dashboard (`/app/`); set `PUBLIC_APP_URL` when building to send them to an app hosted elsewhere. |
| `src/data/tools.ts` | The 16 tools with their tags and descriptions. |
| `src/data/access.ts` | The pricing table: bring your own Comfy key, or your own GPU. |
| `src/data/legal.ts` | Who runs this copy of Kinemi, for the policy pages. |
| `src/lib/pixel-icons.ts` | The 9 × 9 pixel icons of the tools grid. |

## The 3D hand

The robot hand is modeled in code with three.js, not loaded from a file:

- `src/scripts/hand/model.ts`: shapes, materials, joints and poses (fist, rest, framing).
- `src/scripts/hand/scene.ts`: studio lighting in Kinemi colours, camera, intro, idle motion, cursor follow.
- `design/kinemi-hand.glb`: the same model exported as GLB, for Blender, Figma plugins or renders.

How it loads: a pre-rendered poster (AVIF, 8 to 23 KB) paints first. On desktops with a mouse, the
page loads three.js (about 111 KB brotli) after the first paint and swaps in the live hand, which
rises, opens into the framing gesture and follows the cursor. Phones, tablets, data-saver mode and
reduced motion keep the poster. The dashed viewfinder hangs off the index and thumb tips in both cases.

After changing the model, re-render its assets with the dev server running:

```sh
npm run dev
node tools/render-hand.mjs   # poster, fingertip positions and GLB
node tools/og.mjs            # social preview image (public/og.jpg)
```

`/lab/hand` shows the hand on its own while `npm run dev` is running, and `/lab/posters` shows every
placeholder poster scene. Neither is part of the build.

## The studio dashboard

`/app/` is the studio, built from the same tokens, pixel alphabet and icons as the landing page.
It is dark and pixel-edged. Renders run on the user's own compute: the first render asks for a Comfy
key or a local ComfyUI address, then carries on. Until the Comfy bridge is wired in (see below), a
render resolves to a pixel-art placeholder poster that lands in the asset store like the real file.

| Space | Route | What it does |
|---|---|---|
| Chat | `/app/` | Type what you want. The chat picks one of the 16 tools, fills in camera, lens, model and length, and shows runtime and credits before anything renders. “Render it” runs it; “make it 9:16” or “try 85mm” changes one thing. |
| Tools | `/app/tools/`, `/app/tools/<tool>/` | Each tool on its own page: its controls, a viewfinder monitor, the prompt it writes, the cost and the takes. The stage switches between the monitor, the **Comfy graph** behind the tool and its **API JSON**; both update as you edit, and the nodes a change touches light up. Presets is the 60-move library. |
| Academy | `/app/tools/academy/` | 14 lessons in four tracks (camera language, writing and models, working in Kinemi, ComfyUI). Each has a live figure, a “Try it” that opens the tool with the lesson's settings, and a three-question quiz that marks it done. A Glossary tab explains 46 terms. Link to a lesson with `?lesson=<id>`. |
| Supercomputer | `/app/tools/supercomputer/` | A production plan rather than a conversation: deliverables are rows, places, looks or takes are columns, every cell is one render with its own cost. A budget decides what runs, the batch runs in parallel into the campaign's folder, then you approve takes and upscale the keepers. The plan exports as `plan.yaml`. Ask the chat for a campaign and it hands you the plan. |
| Assets | `/app/assets/` | Everything you made. Filter by type, tool and tags, search, sort, grid or list. Drag cards onto a folder or a tag, select several (click the box, shift-click a range) and move, tag, favourite or trash them in one go. Import your own images and clips. |
| Settings | `/app/settings/<section>/` | See below. Open it from the user card, the compute chip in the top bar, or with `,`. |

Every route is a pre-rendered page, so deep links work on any static host.

Cinematic's camera is set visually: a rig pad (a top view for dolly, truck and orbit, a crane strip,
a pan, tilt and zoom head) that plays each move on the monitor as you point at it, a lens test that
shows focal length, field of view, aperture and depth of field live, and picture cards for the body,
the look and the frame. 3D Previz uses the same rig pad and lens ruler. The sidebar folds into a rail
of icons (`[` or the toggle next to the logo).

### Settings

| Section | What it sets |
|---|---|
| Account | On your own computer: the name on the user card. On the web: sign in or create an account; signed in, your name, email, password, sync status, sign out (here or everywhere) and Delete account. |
| Providers | **Your keys**: Comfy Cloud and OpenRouter, saved in this browser only, with a check for each. **Where renders run**: Comfy Cloud or your own GPU (Test connection shows the ComfyUI, Python and PyTorch versions and the GPU), and how many renders run at once. **Chat**: who answers, and the one model it uses. |
| Models | The default video and image models, which models the pickers show (each with its license), and the model file every loader node asks for, with “Check files on my ComfyUI”. |
| Rendering | Resolution, frame rate, negative prompts, the file name pattern, and a spending limit that asks before a costly render. |
| Interface | Motion (follow the system or reduce), the 3D models (auto, on, off), the sidebar, the GPU card, and single-key shortcuts (they can be switched off, WCAG 2.1.4). |
| Notifications | A message, a sound and a browser notification when a render finishes, with a test button. |
| Data & privacy | Storage used, keeping the studio when the browser frees space, export and import a backup (never with keys), empty the trash, delete chats, start over, and the table of everything Kinemi stores. |
| Legal & about | Version and build, the policy pages, licenses, source code and contact. |

### Chat providers

| Provider | Where | How |
|---|---|---|
| Built-in | everywhere | `interpret()` in `src/app/chat/engine.ts` turns text into a tool call with rules. It also answers whenever a model fails. |
| OpenRouter | everywhere | Your key from openrouter.ai/keys; the browser calls OpenRouter directly. Pick one model in Settings (default `openrouter/auto`). |
| Claude Code | on your own computer | `server/local.mjs` runs `claude -p` with every tool off and no session saved, in an empty temporary folder. Install with `npm install -g @anthropic-ai/claude-code`, then sign in by running `claude` once. |
| Codex | on your own computer | `server/local.mjs` runs `codex exec` in a read-only sandbox, in an empty temporary folder. Install with `npm install -g @openai/codex`, then `codex login`. |

A model gets the tool catalogue (every tool and the settings it takes) and answers with JSON. Kinemi
checks that answer against the tool's controls before it becomes a tool call, so a model can't set
anything the controls don't offer. The message shows who answered.

Claude Code and Codex use your own plan with those services. Anthropic's terms allow using your
Claude subscription through Claude Code for yourself, but a service you offer to other people needs
an API key. That is why the CLIs are only offered on your own computer: the server listens on
127.0.0.1 and turns away every other website.

### What lives where

| Path | Holds |
|---|---|
| `src/pages/app/[...path].astro` | The pre-rendered studio routes |
| `src/app/App.tsx`, `src/app/shell/` | Top bar, sidebar (changes per space), render queue, compute dialog |
| `src/app/chat/` | Chat view, composer, `engine.ts` (the built-in rules) and `llm.ts` (OpenRouter, Claude Code, Codex) |
| `src/app/tools/` | Tools grid, the workspace page, `schemas.ts` (each tool's controls), `recipes.ts` (settings to prompt, cost and render) and `Academy.tsx` |
| `src/app/tools/camera-controls.tsx` | The rig pad, the lens test and the body, look and frame cards |
| `src/app/tools/comfy.ts`, `ComfyView.tsx` | The ComfyUI workflow behind each tool (core nodes, API format) and the graph and JSON views |
| `src/app/tools/plan.ts`, `Supercomputer.tsx` | Supercomputer's plan: deliverables, cells, budget, batch run, review, `plan.yaml` |
| `src/app/settings/` | The Settings pages |
| `src/app/compute.ts`, `src/app/local.ts` | Keys, connection checks, model file checks; the link to `server/local.mjs` |
| `src/app/cloud/` | Accounts: the Supabase client, sign-in, sync |
| `src/app/deploy.ts` | The build settings: accounts, guests, sign-in providers |
| `src/app/assets/` | Asset store, detail drawer, drag and drop, import |
| `src/app/three/` | The 3D models and the shared renderer |
| `src/app/lib/poster.ts` | The pixel-art placeholder posters |
| `src/app/data/` | Tools, open models and their licenses, the cost estimator, the 60 camera moves, lessons, glossary, model files, option lists |
| `src/app/seed.ts` | The sample studio a first visit starts with |
| `src/app/styles/app.css` | All dashboard styles |
| `src/app/auth/`, `src/pages/{signin,signup,forgot-password,reset-password}.astro` | The account pages |
| `src/pages/legal/`, `src/layouts/Legal.astro`, `src/data/legal.ts`, `src/data/storage.ts` | The policy pages and what they are filled in from |
| `server/local.mjs` | The server for your own computer |
| `supabase/schema.sql` | Tables, access rules, the file bucket and account deletion for Supabase |

### Wiring it to the real app

- **Rendering**: `src/app/render.ts` runs the queue (single renders one at a time, Supercomputer
  batches up to four abreast, set in Settings → Providers). For now `tick` and `finish` time the job
  and make a placeholder poster; the Comfy bridge replaces them by posting `apiPrompt(graph)` from
  `src/app/tools/comfy.ts` to ComfyUI's `/prompt` and saving the files it returns. The keys and the
  ComfyUI address are in `src/app/compute.ts` (`secrets`, `settings.value.endpoint`); without one,
  rendering asks for it first. Renders stay where they were made (your ComfyUI output folder, or
  Comfy Cloud); a “keep this take” action can later copy them into the account's bucket.
- **Comfy graphs**: `src/app/tools/comfy.ts` builds each tool's workflow from core ComfyUI nodes (Wan 2.2,
  LTX-Video, HunyuanVideo, FLUX, FLUX Kontext, Qwen-Image and Qwen-Image-Edit, Wan VACE for video edits,
  an upscale chain with RIFE from ComfyUI-Frame-Interpolation). Model file names follow the ComfyUI
  example workflows and are listed in `src/app/data/model-files.ts`; users rename them in
  Settings → Models, and the frame rate, negative prompts and file names come from Settings → Rendering.
- **Models and costs**: `src/app/data/models.ts` lists the five families named in the copy (Wan, LTX,
  Hunyuan, FLUX, Qwen) with their licenses. Add the rest of the 14-model registry there, and swap the
  `speed` and `rate` numbers for what your deployment reports.
- **Camera moves and lessons**: `src/app/data/moves.ts` (60 moves with the prompt each one writes),
  `src/app/data/lessons.ts` and `glossary.ts` (the Academy), and `src/app/data/options.ts` (looks, voices).
- **State**: see [Where data lives](#where-data-lives). Settings → Data & privacy starts over.

### The 3D

One three.js renderer draws every 3D slot and copies the pixels into each slot's own canvas, so
twenty models cost one WebGL context and still layer like normal page elements. All of it is
modeled in code:

| Model | Where |
|---|---|
| Kinemi orb: the K as pearl voxels, the green staircase and its seam, rings of light | Chat welcome; turns to the cursor, perks up while you type |
| Cinema camera: film magazine with turning reels, lens, matte box, follow focus, tally light | Tools page |
| Voxel tool icons: each 9 × 9 pixel icon in 3D | Tool cards and tool pages; they breathe apart on hover |
| Graphics card with spinning fans | Sidebar “Render on your own GPU” card |
| Clapperboard lettered in the pixel alphabet | Render queue and renders in progress; snaps when a render starts |
| Film reel with a running film strip | Asset store |
| Previz set with a camera flying the chosen move | 3D Previz monitor; drag to orbit, scroll to zoom, export GLB, copy After Effects keyframes |

three.js loads after the page is idle. Without WebGL 2, with data saver on, or on a software
renderer (no GPU), the pixel-icon fallbacks stay in place; add `?3d=on` to a studio URL to force the
3D on such machines, or pick on or off in Settings → Interface. Reduced motion shows the models still.

### Keyboard

`/` focuses the composer or the asset search · `N` new chat · `1` `2` `3` Chat, Tools, Assets ·
`,` Settings · `[` fold the sidebar into a rail and back ·
in Assets: `⌘/Ctrl A` select all, `F` favourite, `Delete` trash, `Esc` clear · in the drawer: `←` `→`.
Settings → Interface switches the single-key shortcuts off.

## Policies

The policy pages are written for an operator in Germany and describe what Kinemi actually does:

| Page | Covers |
|---|---|
| `/legal/imprint/` | The Impressum (§ 5 DDG), and that you don't take part in consumer dispute resolution (§ 36 VSBG) |
| `/legal/privacy/` | GDPR Art. 13: who is responsible, server logs, what stays in the browser, accounts with Supabase in the EU, ComfyUI, Comfy Cloud and OpenRouter, the emails, storage under § 25 (2) no. 2 TDDDG, rights, retention, minimum age |
| `/legal/terms/` | The service, accounts, content and outputs, bring-your-own compute, model licenses, liability, German law |
| `/legal/acceptable-use/` | What may not be made, labelling deepfakes (EU AI Act Art. 50), reporting abuse |
| `/legal/cookies/` | Everything stored in the browser and why there is no cookie banner |
| `/legal/licenses/` | Kinemi's license, third-party software, and the model licenses |

Before you publish, fill in `src/data/legal.ts`: your name or company, legal form and
representative, street, postcode and city, email and phone, register and VAT ID if you have them,
your state's data protection authority, your host and your email provider with their addresses, how
long the host keeps access logs, the minimum age, and the repository link and license once the code
is public. The build lists every value still in [brackets], and while developing the pages show
a note. The texts are careful drafts, not legal advice: have them checked (by a lawyer, or against
a German generator such as eRecht24) before launch. HunyuanVideo's license excludes the EU, the UK and
South Korea; hide it in Settings → Models, or remove it from `models.ts`, for a site run from Germany.

## Performance

Measured with Lighthouse on the production build:

| | Performance | Accessibility | Best practices | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| Mobile | 100 | 100 | 100 | 100 | 1.4 s | 0 |
| Desktop | 100 | 100 | 100 | 100 | 0.3 s | 0 |

The studio (`/app/`, chat, and `/app/tools/cinematic/`):

| | Performance | Accessibility | Best practices | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| Mobile, chat | 97 | 100 | 100 | 100 | 2.5 s | 0 |
| Mobile, Cinematic | 97 | 100 | 100 | 100 | 2.5 s | 0 |
| Desktop, chat | 100 | 100 | 100 | 100 | 0.6 s | 0 |

The account, policy and Settings pages:

| | Performance | Accessibility | Best practices | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| Mobile, `/signin/` | 100 | 100 | 100 | 100 | 1.2 s | 0 |
| Mobile, `/legal/privacy/` | 100 | 100 | 100 | 100 | 0.9 s | 0 |
| Mobile, `/app/settings/providers/` | 95 | 100 | 100 | 100 | 2.7 s | 0 |
| Desktop, `/app/settings/providers/` | 100 | 100 | 100 | 100 | 0.6 s | 0 |

These come from a server that compresses its files, as every static host does. `server/local.mjs`
serves files as they are, which costs nothing on your own computer.

The landing page's first load is about 66 KB in total: HTML with all CSS and SVG inlined (19 KB
brotli), the font (22 KB), the hand poster (around 20 KB) and about 3 KB of JavaScript. On desktop,
three.js follows after the first paint. The studio's first load is about 125 KB compressed (HTML
with inlined CSS, Preact, the app, the font); three.js follows when the page is idle.

## Tools

The scripts in `tools/` drive a headless Chromium through Playwright, which is not a project
dependency. Install it first with `npm i -D playwright && npx playwright install chromium`.

| Script | Purpose |
|---|---|
| `render-hand.mjs` | Renders the hand poster and fingertip positions, and exports the GLB |
| `og.mjs` | Renders the 1200 × 630 social preview |
| `shot.mjs` | Screenshots of the page at given widths |
| `walk.mjs` | Scrolls the page one screen at a time and saves a contact sheet |
| `qa.mjs` | Checks console errors, reduced motion, JavaScript off, heading outline |
| `app-e2e.mjs` | End-to-end checks of the studio: chat, connect and render, camera controls, Comfy graph and JSON, a Supercomputer batch, folders, tags, trash, import, reload, the Academy, every Settings section, keys, the chat providers, the policy pages and the 404 page |
| `app-cloud.mjs` | Accounts end to end against a stand-in for Supabase: sign up, sign in, sync between two browsers, the guest studio, password reset, account deletion, the sign-in wall. The header says how to build and serve the two builds it needs. |
| `local-server.mjs` | Checks `server/local.mjs` with stand-ins for the `claude` and `codex` commands and for Comfy Cloud: how each CLI is called, and that other websites are refused. Needs `npm run build` first; no browser. |
| `app-shots.mjs` | Screenshots of the studio's main states |
| `app-3d.mjs` | Close-ups of every 3D model in the studio |
| `angles.mjs`, `icons.mjs` | Contact sheets for hand camera angles and the pixel icons |

## Credits

Space Grotesk by Florian Karsten, SIL Open Font License 1.1 (`src/assets/fonts/OFL-SpaceGrotesk.txt`).
