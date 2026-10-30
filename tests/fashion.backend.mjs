/**
 * Fashion Factory backend contract: a garment swap sends both uploaded names into a two-image
 * edit graph, the drape and lighting controls reach the prompt, and a campaign sends the seed the
 * client chose for each model. Runs against a production build and a stub ComfyUI server.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
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
        const image = { filename: `${id}.png`, subfolder: "", type: "output" };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ [id]: { outputs: { save: { images: [image] } } } }));
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

async function upload(fileName) {
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
  assert.equal(response.status, 202, "a valid fashion request should start a job");
  const { jobId } = await response.json();
  return waitForJob(jobId);
}

function lastGraph() {
  return comfy.prompts.at(-1)?.graph ?? {};
}

function nodesOf(graph, classType) {
  return Object.values(graph).filter((node) => node.class_type === classType);
}

function nodeOf(graph, classType) {
  return nodesOf(graph, classType)[0];
}

function textEncodes(graph) {
  return nodesOf(graph, "CLIPTextEncode").map((node) => node.inputs.text);
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

test("a garment swap sends the garment and the model photo as their uploaded names", async () => {
  const garmentName = await upload("my-garment.png");
  const modelName = await upload("my-model.png");
  const job = await submit({
    mode: "fashion",
    modelId: "qwen-image",
    prompt: "swap the garment and model in the shot",
    durationS: 1,
    params: { feature: "swap", target: "both", imageName: garmentName, endImageName: modelName },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "image");

  const graph = lastGraph();
  const loaders = nodesOf(graph, "LoadImage");
  assert.deepEqual(
    loaders.map((node) => node.inputs.image),
    [garmentName, modelName],
    "the garment is image 1 and the model photo image 2",
  );
  assert.notEqual(garmentName, "my-garment.png");
  assert.notEqual(modelName, "my-model.png");

  const encode = nodeOf(graph, "TextEncodeQwenImageEditPlus");
  assert.ok(encode, "the two-image edit node should run");
  assert.equal(graph[encode.inputs.image1[0]]?.inputs.image, garmentName);
  assert.equal(graph[encode.inputs.image2[0]]?.inputs.image, modelName);
  assert.equal(nodeOf(graph, "UNETLoader")?.inputs.unet_name, "qwen_image_edit_2509_fp8_e4m3fn.safetensors");
  assert.ok(nodesOf(graph, "SaveImage").length === 1);
});

test("a garment swap without both photos is refused before a run", async () => {
  const garmentName = await upload("garment-only.png");
  const cases = [
    {
      name: "no photos",
      params: { feature: "swap", target: "both" },
      message: /garment photo/i,
    },
    {
      name: "no model photo",
      params: { feature: "swap", target: "model", imageName: garmentName },
      message: /model or person photo/i,
    },
  ];

  for (const entry of cases) {
    const response = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "fashion",
        modelId: "qwen-image",
        prompt: "swap the garment in the shot",
        durationS: 1,
        params: entry.params,
      }),
    });
    assert.equal(response.status, 502, `${entry.name} must not start a job`);
    assert.match((await response.json()).error, entry.message, `${entry.name} should name the gap`);
  }
});

test("drape and lighting controls reach the still graph prompt", async () => {
  const withKeeps = await submit({
    mode: "fashion",
    modelId: "flux-2-dev",
    prompt: "match the look of the shot",
    durationS: 1,
    params: {
      feature: "match",
      background: "street",
      lightingMatch: 7,
      keepDrape: true,
      keepLighting: true,
    },
  });
  assert.equal(withKeeps.status, "succeeded");
  assert.equal(withKeeps.result.kind, "image");

  const kept = textEncodes(lastGraph()).join("\n");
  assert.match(kept, /background: street/);
  assert.match(kept, /lighting match: 7\/10/);
  assert.match(kept, /preserve the garment drape/);
  assert.match(kept, /preserve the original lighting direction/);
  assert.equal(nodeOf(lastGraph(), "UNETLoader")?.inputs.unet_name, "flux2_dev_fp8mixed.safetensors");

  await submit({
    mode: "fashion",
    modelId: "flux-2-dev",
    prompt: "match the look of the shot",
    durationS: 1,
    params: { feature: "match", background: "studio", lightingMatch: 3 },
  });
  const plain = textEncodes(lastGraph()).join("\n");
  assert.doesNotMatch(plain, /preserve the garment drape/);
  assert.doesNotMatch(plain, /preserve the original lighting direction/);
});

test("a campaign sends one still per model with that model's seed", async () => {
  const seeds = [101, 202, 303];
  const prompts = [
    "influencer campaign: made for the commute (model 1 of 3, standing)",
    "influencer campaign: made for the commute (model 2 of 3, walking)",
    "influencer campaign: made for the commute (model 3 of 3, seated)",
  ];

  for (const [index, seed] of seeds.entries()) {
    const job = await submit({
      mode: "fashion",
      modelId: "qwen-image",
      prompt: prompts[index],
      durationS: 1,
      seed,
      params: { feature: "campaign", models: 3, modelIndex: index, poses: "standing,walking,seated" },
    });
    assert.equal(job.status, "succeeded");
    assert.equal(job.result.kind, "image");
    assert.equal(nodeOf(lastGraph(), "KSampler")?.inputs.seed, seed);
  }
});

test("an unknown fashion feature is refused with the graph name", async () => {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "fashion",
      modelId: "flux-2-dev",
      prompt: "a look",
      durationS: 1,
      params: { feature: "lookbook" },
    }),
  });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /no fashion graph for feature "lookbook"/i);
});
