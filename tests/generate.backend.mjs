/**
 * Generation spine contract: asset intake, one graph per mode, and the result kind each graph
 * declares. Runs against a production build and the stub ComfyUI server in tests/lib/fake-comfy.mjs;
 * no GPU or live deployment is involved. Audio output mapping is covered by tests/audio.backend.mjs,
 * where the audio graph lands.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { startComfy } from "./lib/fake-comfy.mjs";
import { startServer } from "./lib/server.mjs";

/** A 1x1 PNG, enough for the asset route's byte sniffing. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
  "base64",
);
const VIDEO = readFileSync("tests/fixtures/edit-source.webm");
/** The fixed contract: one file, at most 50 MB. */
const MAX_ASSET_BYTES = 50 * 1024 * 1024;

let BASE = "";
let app;
let comfy;

function uploadForm(bytes, fileName, type) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), fileName);
  return form;
}

async function upload(bytes, fileName, type) {
  const response = await fetch(`${BASE}/api/assets`, {
    method: "POST",
    body: uploadForm(bytes, fileName, type),
  });
  assert.equal(response.status, 200, `${fileName} should upload`);
  const body = await response.json();
  assert.equal(typeof body.name, "string", "an upload should return a name");
  return body.name;
}

async function waitForJob(jobId, base = BASE) {
  const deadline = Date.now() + 15000;
  let job;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/jobs/${jobId}`);
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

test("POST /api/assets sniffs the bytes and forwards the file to Comfy", async () => {
  const name = await upload(PNG, "still.png", "image/png");
  assert.match(name, /^upload-\d+\.bin$/, "the name should be the one Comfy answered with");
  assert.equal(comfy.uploads.length, 1, "the stub should receive exactly one upload");
  assert.ok(comfy.uploads[0].bytes > PNG.length, "the multipart body should carry the file");
});

test("POST /api/assets refuses a file that is not image, video or audio", async () => {
  const response = await fetch(`${BASE}/api/assets`, {
    method: "POST",
    body: uploadForm(Buffer.from("this is not a media file"), "notes.txt", "text/plain"),
  });
  assert.equal(response.status, 415, "a text file should be refused");
});

test("POST /api/assets caps a file at 50 MB", async () => {
  const response = await fetch(`${BASE}/api/assets`, {
    method: "POST",
    body: uploadForm(Buffer.alloc(MAX_ASSET_BYTES + 1), "huge.png", "image/png"),
  });
  assert.equal(response.status, 413, "a file over the cap should be refused");
});

test("demo mode stores nothing, returns the demo name and still reports audio", async () => {
  const demo = await startServer();
  try {
    const stored = await fetch(`${demo.base}/api/assets`, {
      method: "POST",
      body: uploadForm(PNG, "still.png", "image/png"),
    });
    assert.equal(stored.status, 200);
    assert.deepEqual(await stored.json(), { name: "demo" });

    const submitted = await fetch(`${demo.base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "audio",
        modelId: "kokoro-tts",
        prompt: "a demo line",
        durationS: 1,
      }),
    });
    assert.equal(submitted.status, 202);
    const { jobId } = await submitted.json();
    const job = await waitForJob(jobId, demo.base);
    assert.equal(job.result?.kind, "audio");
    assert.match(job.result?.url ?? "", /^data:audio\/wav;base64,/);
  } finally {
    demo.stop();
  }
});

test("cinematic text-to-video sends the Wan 2.2 graph and reports a video", async () => {
  const job = await submit({
    mode: "cinematic",
    modelId: "wan22-t2v",
    prompt: "a slow push through a rain-soaked street",
    durationS: 2,
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");
  assert.equal(job.result.width, 1280);
  assert.equal(job.result.height, 720);
  assert.match(job.result.url, /\/view\?filename=/);

  const graph = lastGraph();
  const nodeClasses = classes(graph);
  assert.equal(
    nodeClasses.filter((name) => name === "UNETLoader").length,
    2,
    "the Wan 2.2 graph should load both noise experts",
  );
  for (const expected of ["EmptyHunyuanLatentVideo", "KSamplerAdvanced", "CreateVideo", "SaveVideo"]) {
    assert.ok(nodeClasses.includes(expected), `the graph should send ${expected}`);
  }
});

test("cinematic with a first frame sends the image-to-video graph", async () => {
  const imageName = await upload(PNG, "first.png", "image/png");
  const job = await submit({
    mode: "cinematic",
    modelId: "wan22-i2v",
    prompt: "the camera drifts left",
    durationS: 2,
    params: { imageName },
  });

  assert.equal(job.result.kind, "video");
  const graph = lastGraph();
  assert.equal(nodeOf(graph, "LoadImage")?.inputs.image, imageName, "the uploaded name must travel");
  assert.ok(nodeOf(graph, "WanImageToVideo"), "the graph should animate the still");
  assert.ok(nodeOf(graph, "CLIPVisionEncode"), "the graph should encode the reference frame");
});

test("re-shoot loads the still into an image-to-image graph", async () => {
  const imageName = await upload(PNG, "source.png", "image/png");
  const job = await submit({
    mode: "reshoot",
    modelId: "flux-2-dev",
    prompt: "re-shoot from a low angle",
    durationS: 1,
    params: { imageName },
  });

  assert.equal(job.result.kind, "image");
  assert.match(job.result.url, /\.png/);
  const graph = lastGraph();
  assert.equal(nodeOf(graph, "LoadImage")?.inputs.image, imageName);
  assert.ok(nodeOf(graph, "VAEEncode"), "the still should be encoded as the sampler's latent");
  assert.ok(nodeOf(graph, "SaveImage"), "the still should be saved as an image");
});

test("re-shoot reports video when the picked model outputs video", async () => {
  const imageName = await upload(PNG, "source.png", "image/png");
  const job = await submit({
    mode: "reshoot",
    modelId: "wan22-i2v",
    prompt: "re-shoot from a low angle",
    durationS: 1,
    params: { imageName },
  });

  assert.equal(job.result.kind, "video", "the graph's declared kind wins over the mode name");
  assert.ok(nodeOf(lastGraph(), "SaveVideo"));
});

test("soul renders from text when no source photo is given", async () => {
  const job = await submit({
    mode: "soul",
    modelId: "qwen-image",
    prompt: "one sentence becomes five locked colours",
    durationS: 1,
  });

  assert.equal(job.result.kind, "image");
  const graph = lastGraph();
  assert.ok(nodeOf(graph, "EmptyLatentImage"), "without a photo the graph starts from an empty latent");
  assert.ok(nodeOf(graph, "SaveImage"));
});

test("genjutsu and edit send the source clip to the video-to-video graph", async () => {
  const videoName = await upload(VIDEO, "source.webm", "video/webm");

  const genjutsu = await submit({
    mode: "genjutsu",
    modelId: "wan22-i2v",
    prompt: "transfer the motion onto the character",
    durationS: 2,
    params: { videoName },
  });
  assert.equal(genjutsu.result.kind, "video");
  let graph = lastGraph();
  assert.equal(nodeOf(graph, "LoadVideo")?.inputs.file, videoName);
  assert.ok(nodeOf(graph, "GetVideoComponents"));
  assert.ok(nodeOf(graph, "WanVaceToVideo"));
  assert.ok(nodeOf(graph, "SaveVideo"));

  const edit = await submit({
    mode: "edit",
    modelId: "wan22-i2v",
    prompt: "change the jacket to red",
    durationS: 2,
    params: { videoName, strength: 7 },
  });
  assert.equal(edit.result.kind, "video");
  graph = lastGraph();
  assert.equal(nodeOf(graph, "WanVaceToVideo")?.inputs.control_strength, 0.7);
});

test("a model without a graph answers 502 with the graph name", async () => {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "edit",
      modelId: "ltx-2",
      prompt: "change the jacket to red",
      durationS: 2,
      params: { videoName: "source.webm" },
    }),
  });

  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /no edit graph for model "ltx-2"/);
});

test("a graph that needs an upload answers 502 before a job is made", async () => {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "reshoot",
      modelId: "flux-2-dev",
      prompt: "re-shoot from a low angle",
      durationS: 1,
    }),
  });

  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /imageName/);
});
