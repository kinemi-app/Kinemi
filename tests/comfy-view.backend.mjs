/**
 * Comfy result proxy contract: a keyed cloud ComfyUI answers /view only with the key, so a
 * finished job's result URL points at this server's /api/comfy/view, which fetches the file with
 * the key and streams it back. The browser never sees the deployment's address or key, and the
 * route only ever asks the configured deployment for one output file.
 *
 * Runs against a production build and the keyed stub in tests/lib/fake-comfy.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { startComfy } from "./lib/fake-comfy.mjs";
import { startServer } from "./lib/server.mjs";

const API_KEY = "view-test-key";
const WEBM = readFileSync("tests/fixtures/edit-source.webm");
const VIEW = "/api/comfy/view";

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

async function renderClip() {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "cinematic", modelId: "wan22-t2v", prompt: "a lamp", durationS: 2 }),
  });
  assert.equal(response.status, 202);
  const job = await waitForJob((await response.json()).jobId);
  assert.equal(job.status, "succeeded", job.error);
  return job;
}

before(async () => {
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

test("a keyed deployment's render is served by this server, without its address or key", async () => {
  const job = await renderClip();
  const url = String(job.result.url);
  assert.ok(!url.includes(comfy.url), "the result must not point the browser at the deployment");
  assert.ok(!url.includes(API_KEY), "the result must not carry the key");

  // What a browser does with the result: fetch it relative to the page, with no key of its own.
  const response = await fetch(new URL(url, BASE));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/webm");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEBM);
});

test("a range request reaches the deployment, so a video can seek", async () => {
  const job = await renderClip();
  const response = await fetch(new URL(job.result.url, BASE), { headers: { range: "bytes=0-9" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 0-9/${WEBM.length}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEBM.subarray(0, 10));
});

test("only filename, subfolder and type reach the deployment's /view", async () => {
  const response = await fetch(
    `${BASE}${VIEW}?filename=a.png&subfolder=renders&type=output&url=http://example.com/&channel=rgba`,
  );
  assert.equal(response.status, 200);
  const forwarded = new URL(comfy.views.at(-1), "http://stub");
  assert.equal(forwarded.pathname, "/view");
  assert.deepEqual([...forwarded.searchParams.keys()].sort(), ["filename", "subfolder", "type"]);
  assert.equal(forwarded.searchParams.get("subfolder"), "renders");
});

test("a request for anything but one output file is refused before the deployment is asked", async () => {
  const before = comfy.views.length;
  for (const query of [
    "",
    "subfolder=&type=output",
    "filename=../comfy.env&type=output",
    "filename=a.png&subfolder=../../etc&type=output",
    "filename=a.png&subfolder=/etc&type=output",
    "filename=a/b.png&type=output",
    "filename=a.png&type=input",
  ]) {
    const response = await fetch(`${BASE}${VIEW}?${query}`);
    assert.equal(response.status, 400, `"${query}" should be refused`);
  }
  assert.equal(comfy.views.length, before, "no refused request may reach the deployment");
});

test("a file that is not image, video or audio is never served as itself", async () => {
  const response = await fetch(`${BASE}${VIEW}?filename=page.html&type=output`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("without a deployment the route has nothing to serve", async () => {
  const demo = await startServer();
  try {
    const response = await fetch(`${demo.base}${VIEW}?filename=a.png&type=output`);
    assert.equal(response.status, 404);
  } finally {
    demo.stop();
  }
});
