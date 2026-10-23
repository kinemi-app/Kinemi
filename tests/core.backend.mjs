/**
 * Core flow backend contract: Cinematic, Reshoot, Soul, Genjutsu and Edit each reach their own Comfy
 * graph, send uploaded source assets as /api/assets names, and report the kind their graph declares.
 * Runs against a production build and a stub ComfyUI server; no GPU or live deployment is involved.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { startComfy } from "./lib/fake-comfy.mjs";
import { startServer } from "./lib/server.mjs";

/** A 1x1 PNG: enough bytes for the asset route's type sniffing. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const CLIP = readFileSync("tests/fixtures/edit-source.webm");

let BASE = "";
let app;
let comfy;

async function upload(bytes, fileName, type) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), fileName);
  const response = await fetch(`${BASE}/api/assets`, { method: "POST", body: form });
  assert.equal(response.status, 200, "the asset upload should be accepted");
  const body = await response.json();
  assert.equal(typeof body.name, "string", "the asset upload should return a name");
  return body.name;
}

async function waitForJob(jobId) {
  const deadline = Date.now() + 15000;
  let job;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/api/jobs/${jobId}`);
    job = await response.json();
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return job;
}

async function submit(request) {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(response.status, 202, `${request.mode} should start a job`);
  const { jobId } = await response.json();
  return waitForJob(jobId);
}

function lastGraph() {
  return comfy.prompts.at(-1)?.graph ?? {};
}

/** Every string in the graph, so a test can prove an asset name travelled without naming nodes. */
function graphText(graph) {
  return JSON.stringify(graph);
}

before(async () => {
  comfy = await startComfy();
  app = await startServer({ comfyUrl: comfy.url });
  BASE = app.base;
});

after(async () => {
  app?.stop();
  await comfy?.stop();
});

test("cinematic sends the uploaded first and last frames into a video graph", async () => {
  const first = await upload(PNG, "first-frame.png", "image/png");
  const last = await upload(PNG, "last-frame.png", "image/png");

  const job = await submit({
    mode: "cinematic",
    modelId: "wan22-i2v",
    prompt: "Slow dolly in on the doorway.",
    durationS: 4,
    params: { moves: "dolly-in", firstFrame: true, lastFrame: true, imageName: first, endImageName: last },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");

  const text = graphText(lastGraph());
  assert.ok(text.includes(first), "the first frame should reach the graph by its uploaded name");
  assert.ok(text.includes(last), "the last frame should reach the graph by its uploaded name");
  assert.ok(!text.includes("first-frame.png"), "the browser file name must never reach the graph");
});

test("reshoot loads the uploaded photo and reports an image", async () => {
  const imageName = await upload(PNG, "portrait.png", "image/png");

  const job = await submit({
    mode: "reshoot",
    modelId: "flux-2-dev",
    prompt: "Low angle, 35 mm.",
    durationS: 1,
    params: { preset: "low-angle", imageName },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "image");
  assert.ok(graphText(lastGraph()).includes(imageName), "the source photo should reach the graph");
});

test("soul runs from the uploaded photo, and without one when it is optional", async () => {
  const imageName = await upload(PNG, "soul-source.png", "image/png");

  const fromPhoto = await submit({
    mode: "soul",
    modelId: "flux-2-dev",
    prompt: "Studio portrait, warm palette.",
    durationS: 1,
    params: { palette: "amber", preset: "portrait", imageName },
  });
  assert.equal(fromPhoto.status, "succeeded");
  assert.equal(fromPhoto.result.kind, "image");
  assert.ok(graphText(lastGraph()).includes(imageName), "the source photo should reach the graph");

  const fromText = await submit({
    mode: "soul",
    modelId: "flux-2-dev",
    prompt: "Studio portrait, cool palette.",
    durationS: 1,
    params: { palette: "slate", preset: "portrait" },
  });
  assert.equal(fromText.status, "succeeded");
  assert.equal(fromText.result.kind, "image");
});

test("genjutsu and edit load the uploaded clip by name", async () => {
  const genjutsuName = await upload(CLIP, "performance.webm", "video/webm");
  const genjutsu = await submit({
    mode: "genjutsu",
    modelId: "wan22-i2v",
    prompt: "Sharingan: slow motion, eye glow.",
    durationS: 3,
    params: { operation: "sharingan", character: "Mara", emotions: "focus", sourceDurationS: 2.6, videoName: genjutsuName },
  });
  assert.equal(genjutsu.status, "succeeded");
  assert.equal(genjutsu.result.kind, "video");
  assert.ok(graphText(lastGraph()).includes(genjutsuName), "the source clip should reach the genjutsu graph");

  const editName = await upload(CLIP, "take.webm", "video/webm");
  const edit = await submit({
    mode: "edit",
    modelId: "wan22-i2v",
    prompt: "Restyle as 16 mm film.",
    durationS: 3,
    params: { strength: 6, sourceDurationS: 2.6, videoName: editName },
  });
  assert.equal(edit.status, "succeeded");
  assert.equal(edit.result.kind, "video");
  assert.ok(graphText(lastGraph()).includes(editName), "the source clip should reach the edit graph");
  assert.ok(!graphText(lastGraph()).includes("take.webm"), "the browser file name must never reach the graph");
});

test("every core mode resolves to its own graph", async () => {
  const graphs = comfy.prompts.map((prompt) => JSON.stringify(prompt.graph));
  assert.ok(comfy.prompts.length >= 6, "the suite should have submitted each core mode");
  assert.equal(new Set(graphs).size, graphs.length, "no two core submits may share one graph");
});
