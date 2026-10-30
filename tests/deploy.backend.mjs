/**
 * B4 contract: the deployment check turns this build's graphs into node/file names and compares
 * them with a ComfyUI `/object_info`. A local stub serves the object, so no GPU is involved.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { startServer } from "./lib/server.mjs";

const KEY = "deploy-check-key-42";

let app;
let comfy;
let BASE = "";

function respondJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** A mutable /object_info server; tests replace the object between checks. */
async function startObjectInfoServer() {
  let objectInfo = {};
  let lastAuthorization;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/object_info") {
      lastAuthorization = request.headers.authorization;
      respondJson(response, 200, objectInfo);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    setObjectInfo(value) {
      objectInfo = value;
    },
    authorization: () => lastAuthorization,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function check() {
  const response = await fetch(`${BASE}/api/deploy/check`, { method: "POST" });
  assert.equal(response.status, 200);
  return response.json();
}

/** Everything the first empty check says is missing, as a minimal object_info. */
function completeObjectInfo(missingNodes, missingFiles) {
  const objectInfo = {};
  for (const item of missingNodes) {
    objectInfo[item.node] = {};
  }
  objectInfo.__kinemi_files = missingFiles.map((item) => item.file);
  return objectInfo;
}

before(async () => {
  comfy = await startObjectInfoServer();
  app = await startServer({ comfyUrl: comfy.url, env: { COMFY_API_KEY: KEY } });
  BASE = app.base;
});

after(async () => {
  app?.stop();
  await comfy?.stop();
});

test("a deployment missing a node and a file reports both", async () => {
  comfy.setObjectInfo({});
  const empty = await check();
  assert.equal(empty.ok, false);
  assert.ok(empty.missingNodes.length > 0, "an empty deployment misses nodes");
  assert.ok(empty.missingFiles.length > 0, "an empty deployment misses files");

  const nodeNames = empty.missingNodes.map((item) => item.node);
  const fileNames = empty.missingFiles.map((item) => item.file);
  assert.ok(nodeNames.includes("ChatterboxTTS"), "the audio graphs need ChatterboxTTS");
  assert.ok(nodeNames.includes("ChatterboxVC"), "voice swap needs ChatterboxVC");
  assert.ok(nodeNames.includes("WhisperTranscribe"), "dubbing needs WhisperTranscribe");
  assert.ok(nodeNames.includes("TranslateText"), "dubbing needs TranslateText");
  assert.ok(nodeNames.includes("AudioMatch"), "SFX matching needs AudioMatch");
  assert.ok(
    fileNames.includes("ltx-2.5-22b-dev-transformer-bf16.safetensors"),
    "the cinematic LTX graph needs its checkpoint",
  );
  assert.equal(comfy.authorization(), `Bearer ${KEY}`, "the check should send the bearer key");

  const complete = completeObjectInfo(empty.missingNodes, empty.missingFiles);
  delete complete.ChatterboxTTS;
  complete.__kinemi_files = complete.__kinemi_files.filter(
    (file) => file !== "ltx-2.5-22b-dev-transformer-bf16.safetensors",
  );

  comfy.setObjectInfo(complete);
  const partial = await check();
  assert.equal(partial.ok, false);
  assert.deepEqual(
    partial.missingNodes
      .filter((item) => item.node === "ChatterboxTTS")
      .map((item) => item.feature)
      .sort(),
    ["clone", "dub", "scene", "voiceover"],
    "voiceover, clone, dub and scene each ask for ChatterboxTTS",
  );
  assert.ok(
    partial.missingFiles.some((item) => item.file === "ltx-2.5-22b-dev-transformer-bf16.safetensors"),
    "the missing checkpoint should appear",
  );
});

test("a complete deployment reports nothing missing", async () => {
  comfy.setObjectInfo({});
  const empty = await check();
  const complete = completeObjectInfo(empty.missingNodes, empty.missingFiles);
  comfy.setObjectInfo(complete);

  const response = await fetch(`${BASE}/api/deploy/check`);
  assert.equal(response.status, 200, "GET should answer the same report");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.missingNodes, []);
  assert.deepEqual(body.missingFiles, []);
  assert.deepEqual(
    body.errors,
    [],
    "a sample graph this build could not build must not pass as a clean deployment",
  );

  // The audio, ads and fashion modes split into features; each feature graph is one sample.
  const FEATURE_SAMPLES = { audio: 7, ads: 6, fashion: 3 };
  const registry = JSON.parse(
    await readFile(new URL("../data/models.json", import.meta.url), "utf8"),
  );
  const pairs = registry.reduce(
    (sum, model) =>
      sum + model.modes.filter((mode) => FEATURE_SAMPLES[mode] === undefined).length,
    0,
  );
  const expected =
    pairs + Object.values(FEATURE_SAMPLES).reduce((sum, count) => sum + count, 0);
  assert.equal(body.attempted, expected, "every advertised graph must be sampled, none dropped");
  assert.ok(Array.isArray(body.modes) && body.modes.length > 0);
});

test("a credentialed COMFY_URL is stripped before any request", async () => {
  const credentialed = comfy.url.replace("http://", "http://user:secret@");
  const app = await startServer({ comfyUrl: credentialed });
  try {
    const response = await fetch(`${app.base}/api/deploy/check`, { method: "POST" });
    assert.equal(response.status, 200, "fetch refuses a URL that carries credentials");
    const body = await response.json();
    assert.equal(body.origin, comfy.url, "the report names the endpoint without userinfo");
    assert.equal(comfy.authorization(), undefined, "no basic-auth header is invented");
  } finally {
    app.stop();
  }
});

test("on Comfy Cloud the check sends the key as X-API-Key, never as a Bearer token", async () => {
  await import("./lib/ts-resolve.mjs");
  const { checkDeployment } = await import("../lib/generate/deploy.ts");
  const saved = { url: process.env.COMFY_URL, key: process.env.COMFY_API_KEY };
  process.env.COMFY_URL = "https://cloud.comfy.org/api";
  process.env.COMFY_API_KEY = KEY;
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await checkDeployment(fakeFetch);
  } finally {
    for (const [name, value] of [["COMFY_URL", saved.url], ["COMFY_API_KEY", saved.key]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(sent.length, 1, "one /object_info read");
  assert.equal(sent[0].url, "https://cloud.comfy.org/api/object_info");
  assert.equal(sent[0].headers.get("x-api-key"), KEY);
  assert.equal(sent[0].headers.get("authorization"), null, "Cloud gets no Bearer header");
});

test("without COMFY_URL the check answers 502 with a usable message", async () => {
  const demo = await startServer();
  try {
    const response = await fetch(`${demo.base}/api/deploy/check`, { method: "POST" });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /COMFY_URL/);
  } finally {
    demo.stop();
  }
});
