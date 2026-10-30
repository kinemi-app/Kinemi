/**
 * Canvas cloud chain contract: replay what components/flows/canvas/run.ts sends when one board node
 * feeds the next. A cinematic text-to-video step exports a clip, the clip is imported back through
 * /api/assets/from-url, and the edit step submits it to the deployment by name.
 *
 * This is the cloud proof for the board. tests/collab.browser.mjs proves the same chain in local
 * mode, where the demo generator answers and no endpoint exists.
 *
 * The chain is video to video because that is what a board node can drive today: run.ts sends only
 * `source`, `upstream` and the upstream asset name, and the ads and fashion graphs also require a
 * `feature` param that no node carries. That gap is recorded in TODO.md, not worked around here.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startComfy } from "./lib/fake-comfy.mjs";
import { startServer } from "./lib/server.mjs";

let app;
let comfy;
let BASE = "";

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

const API_KEY = "stub-key";
const VIEW_ROUTE = "/api/comfy/view";

before(async () => {
  // Keyed like a cloud deployment, so an import that fetches /view without the key gets a 401.
  comfy = await startComfy({ apiKey: API_KEY });
  app = await startServer({
    comfyUrl: comfy.url,
    env: { COMFY_API_KEY: API_KEY, GENERATION_MODE: "cloud" },
  });
  BASE = app.base;
});

after(async () => {
  app?.stop();
  await comfy?.stop();
});

test("a board clip is imported and edits in the next step", async () => {
  const take = await submit({
    mode: "cinematic",
    modelId: "wan22-t2v",
    prompt: "a red mug on a table",
    durationS: 3,
    params: { source: "canvas", upstream: "none" },
  });
  assert.equal(take.status, "succeeded", take.error);
  assert.equal(take.result?.kind, "video");
  assert.equal(comfy.prompts.length, 1, "the cinematic step should submit one graph");

  const takeUrl = take.result.url;
  assert.ok(
    takeUrl.startsWith(`${VIEW_ROUTE}?`),
    `the result should be served through this server's view route, got ${takeUrl}`,
  );

  const viewsBefore = comfy.views.length;
  const imported = await fetch(`${BASE}/api/assets/from-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: takeUrl }),
  });
  const asset = await imported.json();
  assert.equal(imported.status, 200, asset.error);
  assert.equal(asset.kind, "video");
  assert.equal(comfy.views.length, viewsBefore + 1, "the import should read /view with the key");
  assert.equal(comfy.uploads.length, 1, "the imported clip should reach the input folder");

  const edit = await submit({
    mode: "edit",
    modelId: "wan22-i2v",
    prompt: "the mug turns slowly",
    durationS: 3,
    params: { source: "canvas", upstream: "Take 1", videoName: asset.name },
  });
  assert.equal(edit.status, "succeeded", edit.error);
  assert.equal(edit.result?.kind, "video");
  assert.equal(comfy.prompts.length, 2, "the edit step should submit a second graph");

  const graph = comfy.prompts[1].graph;
  const classes = Object.values(graph).map((node) => node.class_type);
  assert.ok(classes.includes("WanVaceToVideo"), "the edit step should rework the imported clip");
  const loadVideo = Object.values(graph).find((node) => node.class_type === "LoadVideo");
  assert.equal(loadVideo?.inputs.file, asset.name, "the edit step should load the imported clip");
});

test("an import that names anything but one output file is refused before Comfy is asked", async () => {
  const viewsBefore = comfy.views.length;
  for (const url of [
    "https://example.com/clip.mp4",
    `${VIEW_ROUTE}?filename=../secret.mp4&type=output`,
    `${VIEW_ROUTE}?filename=clip.mp4&type=input`,
  ]) {
    const response = await fetch(`${BASE}/api/assets/from-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    assert.equal(response.status, 400, `${url} should be refused`);
  }
  assert.equal(comfy.views.length, viewsBefore, "a refused import should not reach the deployment");
});

test("an edit step with no imported clip is refused before a graph is submitted", async () => {
  const submitted = comfy.prompts.length;
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "edit",
      modelId: "wan22-i2v",
      prompt: "the mug turns slowly",
      durationS: 3,
      params: { source: "canvas", upstream: "none" },
    }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /edit needs a source clip/);
  assert.equal(comfy.prompts.length, submitted, "a refused step should not reach the deployment");
});
