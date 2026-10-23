/**
 * Upscale backend contract: the source clip uploads as a /api/assets name, ESRGAN is a video
 * graph, RIFE only runs for 60 fps and deflicker only when the value is above zero. Runs against
 * a production build and a stub ComfyUI server; no GPU or live deployment is involved.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { startComfy } from "./lib/fake-comfy.mjs";
import { startServer } from "./lib/server.mjs";

const VIDEO = readFileSync("tests/fixtures/edit-source.webm");

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
  assert.equal(response.status, 202, "a valid upscale should start a job");
  const { jobId } = await response.json();
  return waitForJob(jobId);
}

function lastGraph() {
  return comfy.prompts.at(-1)?.graph ?? {};
}

function classes(graph) {
  return Object.values(graph).map((node) => node.class_type);
}

function nodeOf(graph, classType) {
  return Object.values(graph).find((node) => node.class_type === classType);
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

test("4x upscale sends an ESRGAN video graph with RIFE and deflicker", async () => {
  const videoName = await upload(VIDEO, "source.webm", "video/webm");
  const job = await submit({
    mode: "upscale",
    modelId: "realesrgan-x4",
    prompt: "upscale the clip 4x, interpolate to 60 fps, deflicker 5/10",
    durationS: 3,
    params: { factor: 4, fps: 60, deflicker: 5, sourceDurationS: 3, videoName },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");

  const graph = lastGraph();
  assert.ok(classes(graph).includes("LoadVideo"), "the graph should load the source video");
  assert.ok(classes(graph).includes("UpscaleModelLoader"), "the graph should load an upscale model");
  assert.ok(classes(graph).includes("ImageUpscaleWithModel"), "the graph should upscale frames");
  assert.ok(classes(graph).includes("RIFE VFI"), "60 fps should run interpolation");
  assert.ok(classes(graph).includes("Deflicker"), "a non-zero deflicker should run the node");
  assert.ok(classes(graph).includes("CreateVideo"), "the graph should rebuild the clip");
  assert.ok(classes(graph).includes("SaveVideo"), "the graph should declare a video output");
  assert.equal(nodeOf(graph, "LoadVideo")?.inputs.video, videoName);
  assert.equal(
    nodeOf(graph, "UpscaleModelLoader")?.inputs.model_name,
    "RealESRGAN_x4plus.pth",
  );
});

test("2x at 30 fps skips RIFE and deflicker 0 skips the deflicker node", async () => {
  const videoName = await upload(VIDEO, "source.webm", "video/webm");
  const job = await submit({
    mode: "upscale",
    modelId: "realesrgan-x4",
    prompt: "upscale the clip 2x, keep 30 fps",
    durationS: 3,
    params: { factor: 2, fps: 30, deflicker: 0, sourceDurationS: 3, videoName },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");

  const graph = lastGraph();
  assert.equal(
    nodeOf(graph, "UpscaleModelLoader")?.inputs.model_name,
    "RealESRGAN_x2plus.pth",
  );
  assert.ok(!classes(graph).includes("RIFE VFI"), "30 fps should not interpolate");
  assert.ok(!classes(graph).includes("Deflicker"), "deflicker 0 should not add the node");
  assert.ok(classes(graph).includes("SaveVideo"));
});

test("upscale refuses a missing clip and settings outside the contract", async () => {
  const cases = [
    {
      name: "no clip",
      params: { factor: 4, fps: 60, deflicker: 0, sourceDurationS: 3 },
      message: /videoName|source video/i,
    },
    {
      name: "bad factor",
      params: { factor: 3, fps: 60, deflicker: 0, sourceDurationS: 3, videoName: "demo" },
      message: /factor/i,
    },
    {
      name: "bad fps",
      params: { factor: 4, fps: 24, deflicker: 0, sourceDurationS: 3, videoName: "demo" },
      message: /fps/i,
    },
    {
      name: "bad deflicker",
      params: { factor: 4, fps: 60, deflicker: 11, sourceDurationS: 3, videoName: "demo" },
      message: /deflicker/i,
    },
    {
      name: "bad source length",
      params: { factor: 4, fps: 60, deflicker: 0, sourceDurationS: 0, videoName: "demo" },
      message: /sourceDurationS|source/i,
    },
  ];

  for (const entry of cases) {
    const response = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "upscale",
        modelId: "realesrgan-x4",
        prompt: "A clip.",
        durationS: 3,
        params: entry.params,
      }),
    });
    assert.notEqual(response.status, 202, `${entry.name} must not start a job`);
    assert.equal(response.status, 502, `${entry.name} should be refused before a run`);
    assert.match((await response.json()).error, entry.message, `${entry.name} should name the gap`);
  }
});
