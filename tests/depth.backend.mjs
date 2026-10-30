/**
 * F3 depth analysis: the depth mode submits a LoadImage → DepthAnythingV2Preprocessor → SaveImage
 * graph to ComfyUI, reports the depth map as an image, and refuses a request without a source
 * still. Runs against a production build and the stub ComfyUI server; no GPU or deployment.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startComfy } from "./lib/fake-comfy.mjs";
import { startServer } from "./lib/server.mjs";

/** A 1x1 PNG, enough for the asset route's byte sniffing. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
  "base64",
);
const DEPTH_SIZE = 1024;
const CHECKPOINT = "depth_anything_v2_vitl.pth";

let BASE = "";
let app;
let comfy;

async function upload() {
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "still.png");
  const response = await fetch(`${BASE}/api/assets`, { method: "POST", body: form });
  assert.equal(response.status, 200, "the still should upload");
  const body = await response.json();
  return body.name;
}

function submit(request) {
  return fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
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

function lastGraph() {
  return comfy.prompts.at(-1)?.graph ?? {};
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

test("depth sends the Depth Anything graph and reports an image", async () => {
  const imageName = await upload();
  const response = await submit({
    mode: "depth",
    modelId: "depth-anything-v2",
    prompt: "depth map",
    durationS: 1,
    params: { imageName },
  });
  assert.equal(response.status, 202, "a depth request should start a job");
  const { jobId } = await response.json();
  const job = await waitForJob(jobId);

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "image");
  assert.equal(job.result.width, DEPTH_SIZE);
  assert.equal(job.result.height, DEPTH_SIZE);
  assert.match(job.result.url, /\.png/);

  const graph = lastGraph();
  assert.equal(nodeOf(graph, "LoadImage")?.inputs.image, imageName, "the source still must travel");
  assert.equal(
    nodeOf(graph, "DepthAnythingV2Preprocessor")?.inputs.ckpt_name,
    CHECKPOINT,
    "the depth node should load the Depth Anything V2 checkpoint",
  );
  assert.equal(
    nodeOf(graph, "SaveImage")?.inputs.filename_prefix,
    "kinemi/depth",
    "the depth map should land under the kinemi/depth prefix",
  );
  assert.ok(
    !Object.values(graph).some((node) => node.class_type.startsWith("KSampler")),
    "depth analysis should not sample",
  );
});

test("depth without a source still is refused with the graph's message", async () => {
  const before = comfy.prompts.length;
  const response = await submit({
    mode: "depth",
    modelId: "depth-anything-v2",
    prompt: "depth map",
    durationS: 1,
  });
  assert.equal(response.status, 502, "a request the graph refuses is a failed start");
  const body = await response.json();
  assert.match(body.error, /depth analysis needs a source still/);
  assert.equal(comfy.prompts.length, before, "no graph should reach ComfyUI");
});
