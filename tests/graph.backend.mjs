/**
 * B3 contract: Comfy's refusal body reaches the job error, the graph preview builds without a job
 * or an upstream call, and GENERATION_MODE=cloud refuses before a job exists. A local stub stands
 * in for ComfyUI; no GPU or live deployment is involved.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { startServer } from "./lib/server.mjs";

const REFUSAL = { error: { message: "missing node class ChatterboxTTS" } };

let app;
let comfy;
let BASE = "";

/** A ComfyUI stub whose /prompt always refuses with the node the deployment lacks. */
async function startRefusingComfy() {
  let prompts = 0;
  let lastNodes = {};
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/prompt") {
        prompts += 1;
        lastNodes = JSON.parse(Buffer.concat(chunks).toString("utf8")).prompt;
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify(REFUSAL));
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    promptCount: () => prompts,
    lastClassTypes: () => Object.values(lastNodes).map((node) => node.class_type),
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

function generateBody(overrides = {}) {
  return {
    mode: "audio",
    modelId: "chatterbox",
    prompt: "a calm line for the deployment check",
    durationS: 1,
    params: { feature: "voiceover" },
    ...overrides,
  };
}

async function waitForJob(jobId) {
  const deadline = Date.now() + 15_000;
  let job;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/api/jobs/${jobId}`);
    job = await response.json();
    if (job.status === "failed" || job.status === "succeeded") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return job;
}

before(async () => {
  comfy = await startRefusingComfy();
  app = await startServer({ comfyUrl: comfy.url });
  BASE = app.base;
});

after(async () => {
  app?.stop();
  await comfy?.stop();
});

test("a refused run carries Comfy's body in the job error", async () => {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(generateBody()),
  });
  assert.equal(response.status, 202, "the refusal becomes a failed job, not a route error");

  const { jobId } = await response.json();
  const job = await waitForJob(jobId);
  assert.equal(job.status, "failed");
  assert.match(job.error, /HTTP 400/);
  assert.match(job.error, /missing node class ChatterboxTTS/, "Comfy's own words must travel");
  assert.equal(comfy.promptCount(), 1);
  assert.deepEqual(comfy.lastClassTypes(), ["ChatterboxTTS", "SaveAudio"], "a local voiceover renders on Chatterbox");
});

test("the graph preview returns the nodes without creating a job or calling Comfy", async () => {
  const before = comfy.promptCount();
  const response = await fetch(`${BASE}/api/generate/graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "cinematic",
      modelId: "wan22-t2v",
      prompt: "a slow push through a rain-soaked street",
      durationS: 2,
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.jobId, undefined, "a preview never starts a run");
  assert.equal(body.graph.output, "video");
  assert.equal(body.graph.width, 1280);
  assert.equal(body.graph.height, 720);

  const classes = Object.values(body.graph.nodes).map((node) => node.class_type);
  assert.ok(classes.includes("SaveVideo"), "the preview should carry the real graph");
  assert.ok(classes.includes("KSamplerAdvanced"));
  assert.equal(comfy.promptCount(), before, "the preview must not reach Comfy");
});

test("a graph that needs an upload answers 400 with its message", async () => {
  const response = await fetch(`${BASE}/api/generate/graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "reshoot",
      modelId: "flux-2-dev",
      prompt: "re-shoot from a low angle",
      durationS: 1,
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /imageName/);
});

test("GENERATION_MODE=cloud without COMFY_URL answers 503 before a job exists", async () => {
  const cloud = await startServer({ env: { GENERATION_MODE: "cloud" } });
  try {
    const response = await fetch(`${cloud.base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(generateBody()),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "GENERATION_MODE=cloud needs COMFY_URL",
    });

    const job = await fetch(`${cloud.base}/api/jobs/not-created`);
    assert.equal(job.status, 404, "the refused request must not leave a job behind");
  } finally {
    cloud.stop();
  }
});
