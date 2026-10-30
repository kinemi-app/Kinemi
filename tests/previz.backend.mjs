/**
 * B6 contract: the previz cloud render refuses without an endpoint, and with a stub ComfyUI the
 * frame is uploaded and submitted as a cinematic run. The After Effects script is self-contained.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startComfy } from "./lib/fake-comfy.mjs";
import { startServer } from "./lib/server.mjs";

/** A 1x1 PNG, enough for the route's byte sniffing. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
  "base64",
);

let app;
let comfy;
let BASE = "";

function frameForm(prompt = "the camera pushes in slowly") {
  const form = new FormData();
  form.append("file", new File([PNG], "frame.png", { type: "image/png" }));
  form.append("prompt", prompt);
  form.append("durationS", "3");
  return form;
}

function postRender(base, form) {
  return fetch(`${base}/api/previz/render`, { method: "POST", body: form });
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

test("without an endpoint the render answers 501 and names the local export", async () => {
  const demo = await startServer();
  try {
    const response = await postRender(demo.base, frameForm());
    assert.equal(response.status, 501);
    const body = await response.json();
    assert.match(body.error, /previz cloud render needs COMFY_URL/);
    assert.match(body.error, /local export still works/);
  } finally {
    demo.stop();
  }
});

test("a frame is uploaded and submitted as an image-to-video run", async () => {
  const response = await postRender(BASE, frameForm());
  assert.equal(response.status, 202);

  const body = await response.json();
  assert.equal(typeof body.jobId, "string");
  assert.equal(comfy.uploads.length, 1, "the captured frame should reach the deployment");
  assert.equal(comfy.prompts.length, 1, "the render should submit one graph");

  const graph = comfy.prompts[0].graph;
  const classes = Object.values(graph).map((node) => node.class_type);
  assert.ok(classes.includes("WanImageToVideo"), "the run should animate the captured frame");

  const loadImage = Object.values(graph).find((node) => node.class_type === "LoadImage");
  assert.equal(loadImage?.inputs.image, "upload-1.bin");
});
