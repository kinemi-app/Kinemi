/**
 * Comfy Cloud adapter contract (docs.comfy.org/development/cloud/api-reference): with COMFY_URL on
 * cloud.comfy.org every call carries `X-API-Key`, a run is followed on /job/:id/status and its
 * outputs read from /jobs/:id, a 402 says the credits ran out, and /view's 302 to signed storage is
 * followed without the key. A local ComfyUI keeps Bearer auth and /history polling.
 *
 * Drives lib/generate/comfy.ts directly against the stubs in tests/lib/fake-comfy.mjs; nothing here
 * reaches cloud.comfy.org.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { startComfy } from "./lib/fake-comfy.mjs";
import "./lib/ts-resolve.mjs";

const comfy = await import("../lib/generate/comfy.ts");
const { createProgressFeed } = await import("../lib/generate/comfy-progress-feed.ts");
const { cloudCredits } = await import("../lib/generate/comfy-cost.ts");
const { getJob } = await import("../lib/generate/store.ts");

const API_KEY = "cloud-test-key";
const WEBM = readFileSync(new URL("./fixtures/edit-source.webm", import.meta.url));
const CLIP = { mode: "cinematic", modelId: "wan22-t2v", prompt: "a lamp", durationS: 2, seed: 1 };

const stubs = [];
after(async () => {
  await Promise.all(stubs.map((stub) => stub.stop()));
});

async function stub(options) {
  const started = await startComfy({ apiKey: API_KEY, ...options });
  stubs.push(started);
  return started;
}

/** A Cloud config pointed at the stub; the host check itself is the first test's business. */
function cloudConfig(cloud) {
  return { url: cloud.url, apiKey: API_KEY, isCloud: true };
}

/** Submit one clip and poll until the job leaves `running`, the way the job route does. */
async function render(config, maxPolls = 10) {
  const generator = comfy.createComfyGenerator(config);
  let job = await generator.submit(CLIP);
  for (let poll = 0; poll < maxPolls && job.status === "running"; poll += 1) {
    job = await generator.poll(job);
  }
  return job;
}

test("COMFY_URL on cloud.comfy.org marks the config as Comfy Cloud; any other host is local", () => {
  const saved = { url: process.env.COMFY_URL, key: process.env.COMFY_API_KEY };
  try {
    process.env.COMFY_API_KEY = API_KEY;
    process.env.COMFY_URL = "https://cloud.comfy.org/api";
    assert.equal(comfy.comfyConfigFromEnv()?.isCloud, true);
    for (const local of ["http://127.0.0.1:8188", "https://comfy.example.com", "https://cloud.comfy.org.evil.test/api"]) {
      process.env.COMFY_URL = local;
      assert.equal(comfy.comfyConfigFromEnv()?.isCloud, false, local);
    }
  } finally {
    process.env.COMFY_URL = saved.url ?? "";
    process.env.COMFY_API_KEY = saved.key ?? "";
  }
});

test("Cloud gets X-API-Key and never a Bearer header; a local deployment keeps Bearer", () => {
  assert.deepEqual(comfy.comfyAuthHeaders({ url: "https://cloud.comfy.org/api", apiKey: API_KEY, isCloud: true }), {
    "x-api-key": API_KEY,
  });
  assert.deepEqual(comfy.comfyAuthHeaders({ url: "http://127.0.0.1:8188", apiKey: API_KEY, isCloud: false }), {
    authorization: `Bearer ${API_KEY}`,
  });
  assert.deepEqual(comfy.comfyAuthHeaders({ url: "http://127.0.0.1:8188", apiKey: "", isCloud: false }), {});
});

test("a Cloud run is submitted with the key, followed on /job/:id/status and read from /jobs/:id", async () => {
  const cloud = await stub({ cloud: true, pollsUntilDone: 2 });
  const job = await render(cloudConfig(cloud));
  assert.equal(job.status, "succeeded", job.error);

  const submit = cloud.requests.find((request) => request.path === "/api/prompt");
  assert.equal(submit?.headers["x-api-key"], API_KEY);
  assert.equal(submit?.headers.authorization, undefined, "Cloud must not get the key as a Bearer token");

  const promptId = cloud.prompts[0].id;
  assert.equal(cloud.statusPolls.get(promptId), 2, "the run is followed on its status until it ends");
  assert.ok(cloud.requests.some((request) => request.path === `/api/jobs/${promptId}`), "outputs come from /jobs/:id");

  const result = new URL(job.result.url, "http://kinemi");
  assert.equal(result.pathname, comfy.COMFY_VIEW_ROUTE);
  assert.equal(result.searchParams.get("filename"), `${promptId}-${filenameNode(cloud)}.mp4`);
  assert.equal(job.result.kind, "video");
});

/** The id of the graph's SaveVideo node, which names the stub's output file. */
function filenameNode(cloud) {
  const graph = cloud.prompts[0].graph;
  return Object.keys(graph).find((id) => graph[id].class_type === "SaveVideo");
}

test("a still frame Cloud lists under images beside a clip is never taken as the clip", async () => {
  const cloud = await stub({ cloud: true, previewFrame: "before-clip" });
  const job = await render(cloudConfig(cloud));
  assert.equal(job.status, "succeeded", job.error);
  const result = new URL(job.result.url, "http://kinemi");
  assert.equal(result.searchParams.get("filename"), `${cloud.prompts[0].id}-${filenameNode(cloud)}.mp4`);

  const stillsOnly = await stub({ cloud: true, previewFrame: "instead-of-clip" });
  const failed = await render(cloudConfig(stillsOnly));
  assert.equal(failed.status, "failed", "a run that listed only stills has no clip to show");
  assert.match(failed.error, /without a video output/);
});

test("a Cloud run that ends in error, lost or cancelled fails the job and says why", async () => {
  for (const [status, message] of [
    ["error", "KSampler: CUDA out of memory"],
    ["non_retryable_error", "model file missing"],
    ["lost", null],
    ["cancelled", null],
  ]) {
    const cloud = await stub({ cloud: true, failWith: { status, message } });
    const job = await render(cloudConfig(cloud));
    assert.equal(job.status, "failed", status);
    assert.match(job.error, new RegExp(status), `the error names the Cloud status ${status}`);
    if (message) assert.ok(job.error.includes(message), `the error carries Cloud's message: ${job.error}`);
    assert.ok(!job.error.includes(API_KEY), "the key never reaches a job error");
  }
});

test("a 402 from Cloud tells the user plainly that the credits ran out", async () => {
  const cloud = await stub({ cloud: true, insufficientCredits: true });
  const job = await render(cloudConfig(cloud));
  assert.equal(job.status, "failed");
  assert.match(job.error, /not enough Comfy Cloud credits/i);
  assert.match(job.error, /402/);
});

test("Cloud's /view 302 is followed without the key, and a byte range still reaches the file", async () => {
  const cloud = await stub({ cloud: true });
  const query = { filename: "clip.mp4", subfolder: "", type: "output" };
  const response = await comfy.fetchComfyView(cloudConfig(cloud), query, "bytes=0-9");

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 0-9/${WEBM.length}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEBM.subarray(0, 10));

  const view = cloud.requests.find((request) => request.path.startsWith("/api/view?"));
  assert.equal(view?.headers["x-api-key"], API_KEY, "/view itself is asked with the key");
  assert.equal(cloud.storage.length, 1, "the signed storage link is fetched once");
  assert.equal(cloud.storage[0].hasKey, false, "the key must never reach the storage host");
});

const VIEW_QUERY = { filename: "clip.mp4", subfolder: "", type: "output" };

test("Cloud's /view 302 to a plain-http host is refused: the error names the host and never the signed query", async () => {
  const cloud = await stub({ cloud: true, viewLocation: "http://storage.example.com/x?sig=secret-token" });
  await assert.rejects(
    comfy.fetchComfyView(cloudConfig(cloud), VIEW_QUERY, null),
    (error) => {
      assert.equal(error.message, "Comfy Cloud redirected /view to a non-https location (http://storage.example.com)");
      assert.ok(!error.message.includes("secret-token"), "the signed token must not reach the error");
      return true;
    },
  );
  assert.equal(cloud.storage.length, 0, "no storage link is fetched after a refused redirect");
});

test("Cloud's /view 302 to ftp: or javascript: is refused before anything is fetched", async () => {
  for (const [location, shown] of [
    ["ftp://storage.example.com/x", "ftp://storage.example.com"],
    ["javascript:alert(1)", "javascript://"],
  ]) {
    const cloud = await stub({ cloud: true, viewLocation: location });
    await assert.rejects(
      comfy.fetchComfyView(cloudConfig(cloud), VIEW_QUERY, null),
      new Error(`Comfy Cloud redirected /view to a non-https location (${shown})`),
      location,
    );
    assert.equal(cloud.storage.length, 0, location);
  }
});

test("a plain-http redirect to a host that is not loopback is refused even when Cloud itself is a loopback stub", async () => {
  const cloud = await stub({ cloud: true, viewLocation: "http://localhost.evil.test:80/x" });
  await assert.rejects(comfy.fetchComfyView(cloudConfig(cloud), VIEW_QUERY, null), /non-https location \(http:\/\/localhost\.evil\.test\)/);
});

/** A signed storage link of the stub that answers 302 to `next` (absolute, or relative to itself). */
function storageHop(next) {
  return `/storage/hop?sig=stub-signed&next=${encodeURIComponent(next)}`;
}

const STORAGE_FILE = "/storage/clip.mp4?sig=stub-signed";

test("a storage link that redirects on to plain http is refused with the same message, and its token stays out of the error", async () => {
  const cloud = await stub({ cloud: true, viewLocation: storageHop("http://storage.example.com/x?sig=secret-token") });
  await assert.rejects(
    comfy.fetchComfyView(cloudConfig(cloud), VIEW_QUERY, "bytes=0-9"),
    (error) => {
      assert.equal(error.message, "Comfy Cloud redirected /view to a non-https location (http://storage.example.com)");
      assert.ok(!error.message.includes("secret-token"), "the signed token must not reach the error");
      return true;
    },
  );
  assert.equal(cloud.storage.length, 1, "only the first storage hop is fetched");
});

test("two allowed storage hops in a row still end at the file, keyless and with the range", async () => {
  const cloud = await stub({ cloud: true, viewLocation: storageHop(storageHop(STORAGE_FILE)) });
  const response = await comfy.fetchComfyView(cloudConfig(cloud), VIEW_QUERY, "bytes=0-9");

  assert.equal(response.status, 206);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEBM.subarray(0, 10));
  assert.equal(cloud.storage.length, 3, "two redirecting hops, then the file");
  assert.ok(cloud.storage.every((hit) => !hit.hasKey), "the key never reaches any hop");
});

test("a storage chain past the redirect limit is refused with a clear error", async () => {
  const atLimit = await stub({ cloud: true, viewLocation: storageHop(storageHop(storageHop(STORAGE_FILE))) });
  assert.equal((await comfy.fetchComfyView(cloudConfig(atLimit), VIEW_QUERY, null)).status, 200, "three redirects are allowed");

  const tooLong = await stub({ cloud: true, viewLocation: storageHop(storageHop(storageHop(storageHop(STORAGE_FILE)))) });
  await assert.rejects(
    comfy.fetchComfyView(cloudConfig(tooLong), VIEW_QUERY, null),
    new Error("Comfy Cloud storage redirected more than 3 times"),
  );
  assert.equal(tooLong.storage.length, 4, "the file behind the fourth redirect is never fetched");
});

test("a local ComfyUI is unchanged: Bearer auth, /history polling, /view served directly", async () => {
  const local = await stub({});
  const config = { url: local.url, apiKey: API_KEY, isCloud: false };
  const job = await render(config);
  assert.equal(job.status, "succeeded", job.error);

  for (const request of local.requests) {
    assert.equal(request.headers.authorization, `Bearer ${API_KEY}`, request.path);
    assert.equal(request.headers["x-api-key"], undefined, request.path);
  }
  assert.ok(local.requests.some((request) => request.path.startsWith("/history/")), "local runs are read from /history");
  assert.ok(!local.requests.some((request) => request.path.includes("/status")), "local runs never ask a status route");

  const response = await comfy.fetchComfyView(config, { filename: "a.png", subfolder: "", type: "output" }, null);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
});

// cloud-graphs' sweep retries a refused combination with narrower inputs, so it does reach LTX and
// Hunyuan; these are also built here one by one, with exactly the inputs each takes.
test("the LTX-2, LTX-2.5 and HunyuanVideo 1.5 clips load only nodes, inputs and files Cloud has", async () => {
  const { graphFor } = await import("../lib/generate/workflows/index.ts");
  const cloud = JSON.parse(readFileSync(new URL("./fixtures/cloud-object-info.json", import.meta.url), "utf8"));
  const clips = [
    ["ltx-2", {}], ["ltx-2", { imageName: "first.png" }],
    ["ltx-25", {}], ["ltx-25", { imageName: "first.png" }],
    ["hunyuan-15", {}],
  ];
  for (const [modelId, params] of clips) {
    const label = `${modelId} ${params.imageName ? "image" : "text"}-to-video`;
    const graph = graphFor({ ...CLIP, modelId, params }, "cloud");
    for (const [id, node] of Object.entries(graph.nodes)) {
      const spec = cloud.nodes[node.class_type];
      assert.ok(spec, `${label} node ${id}: ${node.class_type} is not on Cloud`);
      for (const name of spec.required) assert.ok(name in node.inputs, `${label} node ${id}: ${node.class_type} needs ${name}`);
      for (const [name, value] of Object.entries(node.inputs)) {
        const files = cloud.files[`${node.class_type}.${name}`];
        if (files) assert.ok(files.includes(value), `${label} node ${id}: ${node.class_type}.${name} = ${value} is not on Cloud`);
      }
    }
  }
});

test("LTX clips ask for a width and height in steps of 32, which LTX's video VAE needs to encode a frame", async () => {
  const { graphFor } = await import("../lib/generate/workflows/index.ts");
  for (const modelId of ["ltx-2", "ltx-25"]) {
    for (const params of [{}, { imageName: "first.png" }]) {
      const label = `${modelId} ${params.imageName ? "image" : "text"}-to-video`;
      const graph = graphFor({ ...CLIP, modelId, params }, "cloud");
      const sized = Object.entries(graph.nodes).filter(([, node]) => "width" in node.inputs);
      assert.ok(sized.length > 0, `${label}: no node sets the clip's size`);
      for (const [id, node] of sized) {
        for (const size of ["width", "height"]) {
          assert.equal(node.inputs[size] % 32, 0, `${label} node ${id}: ${node.class_type}.${size} = ${node.inputs[size]}`);
          assert.equal(node.inputs[size], graph[size], `${label} node ${id}: the take must report the ${size} the node asks for`);
        }
      }
      assert.deepEqual([graph.width % 32, graph.height % 32], [0, 0], `${label}: the take's size ${graph.width}×${graph.height}`);
    }
  }
});

// Live progress: the generator follows a run through a feed on a fake socket and a clock the test moves.
const CLIENT_ID = "client-7";
const TIMES = { start: 1_700_000_000_000, end: 1_700_000_042_500 };

/** A feed on a fake WebSocket; `send` plays a frame ComfyUI would stream, `clock.at` is its "now". */
function fakeFeed(config) {
  const sockets = [];
  const clock = { at: 1_000 };
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
    }
    close() {}
  }
  const feed = createProgressFeed(
    { url: config.url, apiKey: config.apiKey, isCloud: config.isCloud },
    { WebSocket: FakeSocket, clientId: CLIENT_ID, now: () => clock.at },
  );
  const send = (type, data) => sockets[0].dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type, data }) }));
  return { feed, clock, sockets, send };
}

/** The first graph node with a step count: the sampler whose progress frames the feed follows. */
function samplerOf(deployment) {
  const graph = deployment.prompts[0].graph;
  const id = Object.keys(graph).find((node) => typeof graph[node].inputs?.steps === "number");
  return { id, steps: graph[id].inputs.steps };
}

/** Start the first prompt and stream two sampler steps half a second apart: enough for a step rate. */
function streamTwoSteps(world, deployment) {
  const promptId = deployment.prompts[0].id;
  const sampler = samplerOf(deployment);
  world.send("execution_start", { prompt_id: promptId });
  for (const value of [1, 2]) {
    world.clock.at += 500;
    world.send("progress", { prompt_id: promptId, node: sampler.id, value, max: sampler.steps });
  }
}

/** Poll until the job leaves `running`, the way the job route does. */
async function pollToEnd(generator, first, maxPolls = 10) {
  let job = first;
  for (let poll = 0; poll < maxPolls && job.status === "running"; poll += 1) {
    job = await generator.poll(job);
  }
  return job;
}

test("submit sends the feed's client id and the feed follows the returned prompt id", async () => {
  const cloud = await stub({ cloud: true });
  const world = fakeFeed(cloudConfig(cloud));
  const job = await comfy.createComfyGenerator(cloudConfig(cloud), { feed: world.feed }).submit(CLIP);

  assert.equal(cloud.prompts[0].clientId, CLIENT_ID, "Comfy routes progress to the socket with this id");
  assert.equal(world.sockets.length, 1, "tracking the run opened the socket");
  const queued = world.feed.live(cloud.prompts[0].id);
  assert.equal(queued?.phase, "queued");
  assert.equal(queued?.queuedAt, job.createdAt);
});

test("a polled running job carries the feed's real fraction and the bar follows it", async () => {
  const cloud = await stub({ cloud: true, pollsUntilDone: 3 });
  const world = fakeFeed(cloudConfig(cloud));
  const generator = comfy.createComfyGenerator(cloudConfig(cloud), { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  const promptId = cloud.prompts[0].id;
  const sampler = samplerOf(cloud);

  world.send("execution_start", { prompt_id: promptId });
  world.send("progress", { prompt_id: promptId, node: sampler.id, value: sampler.steps / 2, max: sampler.steps });
  const job = await generator.poll(submitted);

  assert.equal(job.status, "running");
  assert.equal(job.live.phase, "running");
  assert.ok(job.live.fraction > 0 && job.live.fraction < 1, `fraction ${job.live.fraction}`);
  assert.equal(job.live.step, sampler.steps / 2);
  assert.equal(job.progress, Math.round(job.live.fraction * 100));
  assert.equal(getJob(job.id), job, "the stored job is the one that carries live");
});

test("a finished Cloud job reports the GPU time Cloud measured and prices it, and keeps both on the next poll", async () => {
  const cloud = await stub({ cloud: true, pollsUntilDone: 2, executionTimes: TIMES });
  const world = fakeFeed(cloudConfig(cloud));
  const generator = comfy.createComfyGenerator(cloudConfig(cloud), { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  const promptId = cloud.prompts[0].id;
  world.send("execution_start", { prompt_id: promptId });
  world.clock.at += 1_000;

  const job = await pollToEnd(generator, submitted);

  const gpuMs = TIMES.end - TIMES.start;
  assert.equal(job.status, "succeeded", job.error);
  assert.deepEqual(
    [job.live.phase, job.live.fraction, job.live.startedAt, job.live.endedAt, job.live.gpuMs, job.live.source],
    ["done", 1, TIMES.start, TIMES.end, gpuMs, "cloud"],
    "Cloud's timestamps replace the feed's own clock",
  );
  assert.equal(job.live.credits, cloudCredits(gpuMs));
  assert.equal(job.progress, 100);
  assert.equal(world.feed.live(promptId), undefined, "a finished run is forgotten by the feed");

  const again = await generator.poll(job);
  assert.equal(again.live.credits, cloudCredits(gpuMs));
  assert.equal(getJob(job.id).live.gpuMs, gpuMs, "the stored job keeps the final numbers");
});

test("a run Cloud reports finished while the feed still counts steps keeps no time left", async () => {
  const cloud = await stub({ cloud: true, pollsUntilDone: 2, executionTimes: TIMES });
  const world = fakeFeed(cloudConfig(cloud));
  const generator = comfy.createComfyGenerator(cloudConfig(cloud), { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  streamTwoSteps(world, cloud);
  const running = await generator.poll(submitted);
  assert.ok(running.live.remainingMs > 0, "the feed measured a step rate");

  const job = await pollToEnd(generator, running);

  assert.equal(job.status, "succeeded", job.error);
  assert.equal(job.live.phase, "done");
  assert.equal(job.live.remainingMs, undefined, "a finished run has no time left");
});

test("a Cloud detail without timestamps finishes with the feed's GPU time and no credits", async () => {
  const cloud = await stub({ cloud: true, executionTimes: null });
  const world = fakeFeed(cloudConfig(cloud));
  const generator = comfy.createComfyGenerator(cloudConfig(cloud), { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  const promptId = cloud.prompts[0].id;
  world.send("execution_start", { prompt_id: promptId });
  world.clock.at += 3_000;
  world.send("execution_success", { prompt_id: promptId });

  const job = await pollToEnd(generator, submitted);

  assert.equal(job.status, "succeeded", job.error);
  assert.equal(job.live.gpuMs, 3_000);
  assert.equal(job.live.credits, undefined, "no timestamps, no price");
  assert.equal(job.live.phase, "done");
});

test("a run the feed saw nothing of still finishes", async () => {
  const cloud = await stub({ cloud: true, executionTimes: null });
  const silent = { clientId: CLIENT_ID, track() {}, live: () => undefined, forget() {}, close() {} };
  const generator = comfy.createComfyGenerator(cloudConfig(cloud), { feed: silent });
  const job = await pollToEnd(generator, await generator.submit(CLIP));
  assert.equal(job.status, "succeeded", job.error);
  assert.equal(job.live, undefined);
});

test("a finished local run reports the feed's GPU time and never a price", async () => {
  const local = await stub({});
  const config = { url: local.url, apiKey: API_KEY, isCloud: false };
  const world = fakeFeed(config);
  const generator = comfy.createComfyGenerator(config, { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  const promptId = local.prompts[0].id;
  assert.equal(local.prompts[0].clientId, CLIENT_ID);
  world.send("execution_start", { prompt_id: promptId });
  world.clock.at += 2_500;
  world.send("execution_success", { prompt_id: promptId });

  const job = await pollToEnd(generator, submitted);

  assert.equal(job.status, "succeeded", job.error);
  assert.deepEqual([job.live.phase, job.live.fraction, job.live.gpuMs, job.live.source], ["done", 1, 2_500, "local"]);
  assert.equal(job.live.credits, undefined);
  assert.equal(world.feed.live(promptId), undefined, "a finished run is forgotten by the feed");
});

test("a failed Cloud run is forgotten by the feed", async () => {
  const cloud = await stub({ cloud: true, failWith: { status: "error", message: "out of memory" } });
  const world = fakeFeed(cloudConfig(cloud));
  const generator = comfy.createComfyGenerator(cloudConfig(cloud), { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  const promptId = cloud.prompts[0].id;
  world.send("execution_start", { prompt_id: promptId });
  assert.ok(world.feed.live(promptId), "the feed follows the run while it is live");

  const job = await generator.poll(submitted);

  assert.equal(job.status, "failed");
  assert.equal(world.feed.live(promptId), undefined);
});

test("a failed Cloud run closes its live reading and keeps no time left", async () => {
  const cloud = await stub({ cloud: true, failWith: { status: "failed", message: "out of memory" } });
  const world = fakeFeed(cloudConfig(cloud));
  const generator = comfy.createComfyGenerator(cloudConfig(cloud), { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  const promptId = cloud.prompts[0].id;
  streamTwoSteps(world, cloud);
  assert.ok(world.feed.live(promptId).remainingMs > 0, "the feed measured a step rate");

  const job = await generator.poll(submitted);

  assert.equal(job.status, "failed");
  assert.match(job.error, /out of memory/);
  assert.equal(job.live.phase, "done");
  assert.equal(job.live.remainingMs, undefined);
});

/**
 * A local ComfyUI that takes one prompt as `p1` and answers every /history read with `history`;
 * the shared stub only ever answers a finished run.
 */
async function localWithHistory(history) {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const isSubmit = request.method === "POST" && request.url === "/prompt";
      const isHistory = request.method === "GET" && request.url === "/history/p1";
      response.writeHead(isSubmit || isHistory ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(isSubmit ? { prompt_id: "p1" } : isHistory ? history : {}));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const stop = () => new Promise((resolve) => (server.close(resolve), server.closeAllConnections()));
  stubs.push({ stop });
  return { url: `http://127.0.0.1:${server.address().port}`, apiKey: "", isCloud: false };
}

const EXECUTION_ERROR = {
  prompt_id: "p1",
  node_id: "3",
  node_type: "KSampler",
  exception_message: "CUDA out of memory",
  exception_type: "torch.OutOfMemoryError",
};

test("a local run whose /history says error fails with ComfyUI's reason and a closed live", async () => {
  const history = {
    p1: {
      status: {
        status_str: "error",
        completed: false,
        messages: [["execution_start", { prompt_id: "p1" }], ["execution_error", EXECUTION_ERROR]],
      },
      outputs: {},
    },
  };
  const config = await localWithHistory(history);
  const world = fakeFeed(config);
  const generator = comfy.createComfyGenerator(config, { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  world.send("execution_start", { prompt_id: "p1" });
  assert.equal(world.feed.live("p1")?.phase, "running");

  const job = await pollToEnd(generator, submitted);

  assert.equal(job.status, "failed");
  assert.match(job.error, /ComfyUI ended the run with an error: CUDA out of memory/);
  assert.equal(job.live.phase, "done");
  assert.equal(job.live.remainingMs, undefined);
  assert.equal(world.feed.live("p1"), undefined, "a failed run is forgotten by the feed");
});

test("a local run the socket reports as errored fails before /history has an entry", async () => {
  const config = await localWithHistory({});
  const world = fakeFeed(config);
  const generator = comfy.createComfyGenerator(config, { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  world.send("execution_start", { prompt_id: "p1" });
  world.send("execution_error", EXECUTION_ERROR);

  const job = await pollToEnd(generator, submitted);

  assert.equal(job.status, "failed", "the job must not stay running");
  assert.match(job.error, /CUDA out of memory/);
  assert.equal(job.live.phase, "done");
  assert.equal(job.live.remainingMs, undefined);
});

/** Submit one clip to a local ComfyUI whose /history is `history`, play `frames` on its socket, poll to the end. */
async function runLocal(history, frames = () => {}) {
  const config = await localWithHistory(history);
  const world = fakeFeed(config);
  const generator = comfy.createComfyGenerator(config, { feed: world.feed });
  const submitted = await generator.submit(CLIP);
  frames(world.send);
  return pollToEnd(generator, submitted);
}

/** A /history answer for `p1`: ComfyUI's status string, its status messages and the files it wrote. */
const historyOf = (statusStr, messages, outputs = {}) => ({ p1: { status: { status_str: statusStr, messages }, outputs } });

test("a local run that streamed a queue notice and then succeeded is never read as failed", async () => {
  const outputs = { 9: { videos: [{ filename: "clip.mp4", subfolder: "", type: "output" }] } };
  const job = await runLocal(historyOf("success", [["execution_success", { prompt_id: "p1" }]], outputs), (send) => {
    send("notification", { value: "Waiting for a machine…" });
    send("execution_start", { prompt_id: "p1" });
    send("progress", { prompt_id: "p1", node: "3", value: 1, max: 4 });
    send("execution_success", { prompt_id: "p1" });
  });

  assert.equal(job.status, "succeeded", job.error);
  assert.equal(new URL(job.result.url, "http://kinemi").searchParams.get("filename"), "clip.mp4");
});

test("a local run /history marks as an error with only execution_interrupted says it was interrupted", async () => {
  const job = await runLocal(historyOf("error", [["execution_interrupted", { prompt_id: "p1", node_id: "3", node_type: "KSampler", executed: [] }]]));

  assert.equal(job.status, "failed");
  assert.match(job.error, /interrupted/);
  assert.doesNotMatch(job.error, /reported an error/);
});

test("a local execution_error without an exception message names the node that failed", async () => {
  const job = await runLocal(historyOf("error", [["execution_error", { ...EXECUTION_ERROR, exception_message: undefined }]]));

  assert.equal(job.status, "failed");
  assert.match(job.error, /KSampler/);
});
