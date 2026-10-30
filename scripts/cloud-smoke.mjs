#!/usr/bin/env node
// One cheap real render per mode and feature, against a running Kinemi server that points at a
// ComfyUI (Comfy Cloud or local). Each run is 1 s on the cheapest registry model whose graph the
// server builds, except cinematic, which runs every model; a model that refuses the last frame (or
// every frame) is planned with narrower inputs. The check (POST /api/generate/graph) creates no
// job and costs nothing.
//
//   node scripts/cloud-smoke.mjs --dry-run                 the plan and its estimate, nothing sent
//   node scripts/cloud-smoke.mjs --yes --max-credits 8     render, stopping before the cap
//
// The estimate is Kinemi's registry credits (creditsPerSecond x seconds), not Comfy Cloud's bill:
// watch the Cloud dashboard during the first run.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const POLL_MS = 2000;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
/** One HTTP call to the Kinemi server; a stuck call must not outlast the job timeout. */
const REQUEST_TIMEOUT_MS = 60 * 1000;
const FFMPEG_TIMEOUT_MS = 30 * 1000;
const DURATION_S = 1;

const VARIANTS = {
  audio: ["voiceover", "clone", "swap", "dub", "scene", "sfx"].map((feature) => ({ feature })),
  ads: ["product", "hooks", "posters", "ugc", "unboxing", "tutorial"].map((feature) => ({ feature })),
  fashion: ["swap", "match", "campaign"].map((feature) => ({ feature })),
  upscale: [{ factor: 2 }],
};

/** Options every graph may read; a graph ignores what it doesn't use. Dub stays in English. */
const BASE_PARAMS = { consent: true, language: "en", speaker: "Ana", fps: 30, deflicker: 0, sourceDurationS: DURATION_S };

/**
 * Tried first wherever they serve the mode. Registry credits rank Qwen-Image (20B) below FLUX.2
 * Klein 4B, but Cloud bills GPU time, where the 4B model is the cheap one.
 */
const CHEAPEST_ON_GPU = ["flux-3-klein"];

/** The mode whose models differ in what they take as input, so each one is rendered, not just the cheapest. */
const EVERY_MODEL_MODE = "cinematic";

function byGpuCost(a, b) {
  const rank = (model) => (CHEAPEST_ON_GPU.includes(model.id) ? 0 : 1);
  return rank(a) - rank(b) || a.creditsPerSecond - b.creditsPerSecond;
}

function parseArgs(argv) {
  const args = { base: "http://127.0.0.1:3000", yes: false, dryRun: false, maxCredits: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--yes") args.yes = true;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--base") args.base = argv[(i += 1)];
    else if (flag === "--max-credits") args.maxCredits = Number(argv[(i += 1)]);
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

/** Checked only after the plan is printed, so a refused run still shows what it would cost. */
function assertMaySpend(args, status) {
  if (!args.yes) throw new Error("nothing rendered: add --yes to spend credits");
  if (!(args.maxCredits > 0)) throw new Error("nothing rendered: --max-credits <n> is required for a real run");
  if (status.generation !== "cloud") {
    throw new Error(`nothing rendered: ${args.base} renders with the demo generator; set COMFY_URL and restart it`);
  }
}

/**
 * The planned request with the uploaded source names in place of the placeholders. Only the sources
 * the plan kept are filled in: a frame dropped for the model must not come back at render time.
 */
function withSources(run, sources) {
  const params = Object.fromEntries(Object.entries(run.request.params).map(([name, value]) => [name, sources[name] ?? value]));
  return { ...run, request: { ...run.request, params } };
}

async function call(base, path, init) {
  const response = await fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

const postJson = (base, path, payload) =>
  call(base, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

function label(mode, extra, model) {
  return [mode, extra.feature ?? (extra.factor ? `x${extra.factor}` : ""), model?.id ?? "-"].filter(Boolean).join("/");
}

/**
 * Inputs to drop, in order, when a model refuses them, with the graph builder's refusal that calls for
 * each: LTX takes no last frame, Hunyuan 1.5 (text to video only) no frame at all. Without these the
 * model would drop out of the plan unseen. The patterns are checked against the real messages of
 * lib/generate/workflows/cinematic.ts in tests/cloud-smoke.backend.mjs.
 */
export const NARROWINGS = [
  { drop: "endImageName", refusal: /takes a first frame, not a last frame$/ },
  { drop: "imageName", refusal: /has no image-to-video graph in this build$/ },
];

const without = (params, names) => Object.fromEntries(Object.entries(params).filter(([name]) => !names.includes(name)));

/** The run for one model and variant, built from the widest inputs it accepts, or its first refusal. */
async function planOne(base, mode, model, extra, sources) {
  let firstRefusal;
  for (let step = 0; step <= NARROWINGS.length; step += 1) {
    const dropped = NARROWINGS.slice(0, step).map((narrowing) => narrowing.drop);
    const request = {
      mode,
      modelId: model.id,
      prompt: "a lighthouse at dusk, slow push in",
      durationS: DURATION_S,
      seed: 1,
      params: without({ ...BASE_PARAMS, ...sources, ...extra }, dropped),
    };
    const built = await postJson(base, "/api/generate/graph", request);
    if (built.ok) return { request, model, credits: model.creditsPerSecond * DURATION_S };
    const refusal = built.body.error ?? `HTTP ${built.status}`;
    if (!NARROWINGS.some((narrowing) => narrowing.refusal.test(refusal))) return { refusal };
    firstRefusal ??= refusal;
  }
  return { refusal: firstRefusal };
}

/**
 * Every mode x feature, each on the cheapest model whose graph the server builds, or its refusal.
 * Cinematic is the exception: every cinematic model gets its own run, so none goes unrendered.
 */
export async function planRuns(base, models, sources) {
  const modes = [...new Set(models.flatMap((model) => model.modes ?? []))];
  const runs = [];
  for (const mode of modes) {
    const candidates = models.filter((model) => (model.modes ?? []).includes(mode));
    candidates.sort(byGpuCost);
    for (const extra of VARIANTS[mode] ?? [{}]) {
      if (mode === EVERY_MODEL_MODE) {
        for (const model of candidates) {
          runs.push({ label: label(mode, extra, model), ...(await planOne(base, mode, model, extra, sources)) });
        }
        continue;
      }
      let refusal = "no model builds this graph";
      let picked;
      for (const model of candidates) {
        const attempt = await planOne(base, mode, model, extra, sources);
        if (attempt.refusal === undefined) {
          picked = attempt;
          break;
        }
        refusal = attempt.refusal;
      }
      runs.push({ label: label(mode, extra, picked?.model), ...(picked ?? { refusal }) });
    }
  }
  return runs;
}

/** A 64x64 grey PNG, written by hand so the script needs no image library. */
function png() {
  const size = 64;
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((size * 3 + 1) * size, 128);
  for (let y = 0; y < size; y += 1) rows[y * (size * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** One second of a 440 Hz tone, 16 kHz mono PCM. */
function wav() {
  const rate = 16000;
  const samples = Buffer.alloc(rate * 2);
  for (let i = 0; i < rate; i += 1) samples.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

const ffmpegPath = () => process.env.KINEMI_FFMPEG_PATH || "ffmpeg";

function isFfmpegAvailable() {
  return spawnSync(ffmpegPath(), ["-version"], { stdio: "ignore", timeout: FFMPEG_TIMEOUT_MS }).status === 0;
}

/** One second of test pattern with a tone, through ffmpeg; undefined when ffmpeg isn't there. */
function mp4() {
  const folder = mkdtempSync(join(tmpdir(), "kinemi-smoke-"));
  const out = join(folder, "clip.mp4");
  const ffmpeg = ffmpegPath();
  const args = ["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=16", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1", "-pix_fmt", "yuv420p", "-shortest", out];
  try {
    return spawnSync(ffmpeg, args, { stdio: "ignore", timeout: FFMPEG_TIMEOUT_MS }).status === 0 ? readFileSync(out) : undefined;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

async function upload(base, bytes, type, name) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type }), name);
  const stored = await call(base, "/api/assets", { method: "POST", body: form });
  if (!stored.ok) throw new Error(`upload of ${name} failed: ${stored.body.error ?? stored.status}`);
  return stored.body.name;
}

async function uploadSources(base, video) {
  const imageName = await upload(base, png(), "image/png", "smoke.png");
  return {
    imageName,
    endImageName: imageName,
    audioName: await upload(base, wav(), "audio/wav", "smoke.wav"),
    ...(video === undefined ? {} : { videoName: await upload(base, video, "video/mp4", "smoke.mp4") }),
  };
}

async function render(base, run) {
  const started = Date.now();
  const accepted = await postJson(base, "/api/generate", run.request);
  if (!accepted.ok) return { failed: true, text: `FAILED · refused · ${accepted.body.error ?? accepted.status}` };
  const jobId = accepted.body.jobId;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    const job = await call(base, `/api/jobs/${jobId}`).then(
      (polled) => polled.body,
      () => ({ status: "unreachable" }),
    );
    if (job.status === "unreachable") {
      return { failed: true, timedOut: true, text: `FAILED · no status for job ${jobId} after ${seconds}s · it may still be running upstream` };
    }
    if (job.status === "succeeded") return { failed: false, text: `ok · ${seconds}s · ${job.result?.url ?? "no url"}` };
    if (job.status === "failed") return { failed: true, text: `FAILED · ${job.error ?? "no reason"}` };
    if (Date.now() - started > JOB_TIMEOUT_MS) {
      return { failed: true, timedOut: true, text: `FAILED · timed out after ${seconds}s · job ${jobId} may still be running upstream` };
    }
  }
}

function printPlan(runs) {
  for (const run of runs) console.log(`  ${run.label.padEnd(40)} ${run.refusal ? `refused before submit: ${run.refusal}` : `${run.credits.toFixed(2)} cr`}`);
  const total = runs.reduce((sum, run) => sum + (run.credits ?? 0), 0);
  console.log(`estimate: ${total.toFixed(2)} registry credits for ${runs.filter((run) => !run.refusal).length} renders`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(readFileSync(new URL("../data/models.json", import.meta.url), "utf8"));
  const models = registry.models ?? registry;
  const status = (await call(args.base, "/api/status")).body;
  // a dry run only plans, so it asks whether a clip could be made instead of encoding one
  const video = args.dryRun ? undefined : mp4();
  const hasClip = args.dryRun ? isFfmpegAvailable() : video !== undefined;
  // without a source clip the video runs must show as refused in the plan, not be sent anyway
  const placeholders = { imageName: "smoke.png", endImageName: "smoke.png", audioName: "smoke.wav", ...(hasClip ? { videoName: "smoke.mp4" } : {}) };

  console.log(`plan against ${args.base}, rendering on ${status.generation === "cloud" ? status.comfy?.origin : "the demo generator"} (graph checks only, no jobs):`);
  if (!hasClip) console.log("ffmpeg not found: no source clip, so the video-source runs are refused below");
  const plan = await planRuns(args.base, models, placeholders);
  printPlan(plan);
  if (args.dryRun) return;
  assertMaySpend(args, status);

  const sources = await uploadSources(args.base, video);
  let spent = 0;
  let failed = 0;
  for (const run of plan.filter((entry) => !entry.refusal)) {
    if (spent + run.credits > args.maxCredits) {
      console.log(`stopped: ${run.label} would pass --max-credits ${args.maxCredits} (spent ${spent.toFixed(2)})`);
      break;
    }
    spent += run.credits;
    const outcome = await render(args.base, withSources(run, sources));
    if (outcome.failed) failed += 1;
    console.log(`${run.label} · ${outcome.text}`);
    if (outcome.timedOut) {
      console.log("stopped: a job timed out, so no further renders were sent");
      break;
    }
  }
  console.log(`done: ${spent.toFixed(2)} registry credits, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main().catch((error) => {
    console.error(`cloud-smoke: ${error.message}`);
    process.exitCode = 2;
  });
}
