/**
 * Marketing Studio backend contract: every panel reaches a real Comfy graph, product photos
 * travel as /api/assets names, the video panel composes before it animates, and the URL importer
 * refuses private hosts. Runs against a production build and a stub ComfyUI server; no GPU or live
 * deployment is involved.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { startServer } from "./lib/server.mjs";

/** A real 1x1 PNG; the asset route sniffs the bytes, so the declared upload type is not trusted. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let BASE = "";
let app;
let comfy;

/** The smallest Comfy the adapter needs: record /prompt, answer /history, accept uploads. */
async function startComfy() {
  const prompts = [];
  let uploadCount = 0;

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);

      if (request.method === "POST" && request.url === "/prompt") {
        const parsed = JSON.parse(body.toString());
        const id = `p${prompts.length + 1}`;
        prompts.push({ id, graph: parsed.prompt });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ prompt_id: id }));
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/history/")) {
        const id = request.url.slice("/history/".length);
        const entry = prompts.find((prompt) => prompt.id === id);
        const classes = Object.values(entry?.graph ?? {}).map((node) => node.class_type);
        const file = { filename: `${id}.png`, subfolder: "", type: "output" };
        const video = { filename: `${id}.mp4`, subfolder: "", type: "output" };
        const output = classes.includes("SaveVideo")
          ? { videos: [video], gifs: [video] }
          : { images: [file] };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ [id]: { outputs: { save: output } } }));
        return;
      }

      if (request.method === "POST") {
        uploadCount += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ name: `upload-${uploadCount}.png`, subfolder: "", type: "input" }),
        );
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
    prompts,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function upload(fileName = "product-photo.png") {
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), fileName);
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
  assert.equal(response.status, 202, "a valid ads request should start a job");
  const { jobId } = await response.json();
  return waitForJob(jobId);
}

function lastGraph() {
  return comfy.prompts.at(-1)?.graph ?? {};
}

function classes(graph) {
  return Object.values(graph).map((node) => node.class_type);
}

function nodesOf(graph, classType) {
  return Object.values(graph).filter((node) => node.class_type === classType);
}

function nodeOf(graph, classType) {
  return nodesOf(graph, classType)[0];
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

test("a product ad carries the uploaded name, not the browser file name", async () => {
  const imageName = await upload("my-product.png");
  const job = await submit({
    mode: "ads",
    modelId: "flux-2-dev",
    prompt: "product ad, 1:1 format",
    durationS: 1,
    params: { feature: "product", format: "1:1", imageName },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "image");

  const graph = lastGraph();
  assert.equal(nodeOf(graph, "LoadImage")?.inputs.image, imageName);
  assert.notEqual(nodeOf(graph, "LoadImage")?.inputs.image, "my-product.png");
  assert.ok(classes(graph).includes("SaveImage"));
});

test("a product ad without a photo is refused before a run", async () => {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "ads",
      modelId: "flux-2-dev",
      prompt: "product ad, 1:1 format",
      durationS: 1,
      params: { feature: "product", format: "1:1" },
    }),
  });

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /product photo/i);
});

test("posters use the shared product photo only when one is present", async () => {
  const imageName = await upload("poster-product.png");
  const withPhoto = await submit({
    mode: "ads",
    modelId: "flux-2-dev",
    prompt: "marketplace poster, square format",
    durationS: 1,
    params: { feature: "posters", size: "square", motion: false, imageName },
  });
  assert.equal(withPhoto.result.kind, "image");
  assert.equal(nodeOf(lastGraph(), "LoadImage")?.inputs.image, imageName);

  const withoutPhoto = await submit({
    mode: "ads",
    modelId: "flux-2-dev",
    prompt: "marketplace poster, square format",
    durationS: 1,
    params: { feature: "posters", size: "square", motion: false },
  });
  assert.equal(withoutPhoto.result.kind, "image");
  assert.equal(nodeOf(lastGraph(), "LoadImage"), undefined);
  assert.ok(classes(lastGraph()).includes("EmptyLatentImage"));
});

test("hooks render one still per submit on the ads image model", async () => {
  const job = await submit({
    mode: "ads",
    modelId: "qwen-image",
    prompt: "hook variation 1/5: POV: a desk lamp that charges your phone",
    durationS: 1,
    seed: 1,
    params: { feature: "hooks", variantIndex: 0, variantCount: 5 },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "image");
  assert.ok(classes(lastGraph()).includes("SaveImage"));
  assert.equal(nodeOf(lastGraph(), "LoadImage"), undefined);
});

test("UGC with a product photo composes the scene, then animates the composed still", async () => {
  const imageName = await upload("ugc-product.png");
  const job = await submit({
    mode: "ads",
    modelId: "wan22-i2v",
    prompt: "UGC video (4 s), product placement: open the box and hold up the bottle",
    durationS: 4,
    params: { feature: "ugc", imageName },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");

  const graph = lastGraph();
  assert.ok(classes(graph).includes("FluxKontextImageScale"), "the compose stage should run");
  assert.ok(classes(graph).includes("ReferenceLatent"), "the product should be the edit reference");
  assert.ok(classes(graph).includes("WanImageToVideo"), "the composed still should animate");
  assert.ok(classes(graph).includes("SaveVideo"), "the run should declare a video output");

  const loaders = nodesOf(graph, "LoadImage");
  assert.equal(loaders.length, 1, "only the compose stage loads a file");
  assert.equal(loaders[0]?.inputs.image, imageName);

  const start = nodeOf(graph, "WanImageToVideo")?.inputs.start_image;
  assert.ok(Array.isArray(start), "the clip should start from a connected image");
  const composed = graph[start[0]];
  assert.equal(composed?.class_type, "VAEDecode", "the clip should start from the composed pixels");
  assert.equal(nodeOf(graph, "CLIPVisionEncode")?.inputs.image?.[0], start[0]);
});

test("UGC without a photo runs text-to-video and never claims product placement", async () => {
  const job = await submit({
    mode: "ads",
    modelId: "wan22-t2v",
    prompt: "tutorial video (4 s): show the three steps on a counter",
    durationS: 4,
    params: { feature: "tutorial" },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");

  const graph = lastGraph();
  assert.ok(classes(graph).includes("EmptyHunyuanLatentVideo"));
  assert.ok(classes(graph).includes("SaveVideo"));
  assert.equal(nodeOf(graph, "LoadImage"), undefined);
  assert.equal(nodeOf(graph, "WanImageToVideo"), undefined);
  assert.equal(nodeOf(graph, "FluxKontextImageScale"), undefined);
});

test("the ads registry offers a video model and a run on it reports video", async () => {
  const models = JSON.parse(readFileSync("data/models.json", "utf8"));
  const videoModels = models.filter(
    (model) => model.modes.includes("ads") && model.kind === "video",
  );
  assert.ok(videoModels.length >= 1, "the ads mode must offer at least one video model");

  const job = await submit({
    mode: "ads",
    modelId: videoModels[0].id,
    prompt: "unboxing video (4 s): lift the lid and show the label",
    durationS: 4,
    params: { feature: "unboxing" },
  });
  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");
});

test("the URL importer refuses loopback and non-http URLs", async () => {
  const cases = [
    { url: "http://127.0.0.1/photo.png", status: 403, message: /not a public host/i },
    { url: "http://localhost/photo.png", status: 403, message: /private address/i },
    { url: "file:///etc/passwd", status: 400, message: /http/i },
  ];

  for (const entry of cases) {
    const response = await fetch(`${BASE}/api/import-image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: entry.url }),
    });
    assert.equal(response.status, entry.status, `${entry.url} should be refused`);
    assert.match((await response.json()).error, entry.message, `${entry.url} should say why`);
  }
});

test("the URL importer refuses a 20 MB request body", async () => {
  const body = JSON.stringify({ url: `https://example.com/${"a".repeat(20 * 1024 * 1024)}` });
  const response = await fetch(`${BASE}/api/import-image`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/i);
});
