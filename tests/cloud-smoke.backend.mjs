// The Cloud smoke plan must show every cinematic model, narrowing the inputs a model refuses and
// naming the refusal of one that builds nothing, instead of dropping it without a trace.
// A fake Kinemi server stands in for POST /api/generate/graph; nothing renders and nothing is spent.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import "./lib/ts-resolve.mjs";

const { NARROWINGS, planRuns } = await import("../scripts/cloud-smoke.mjs");
const { graph: cinematicGraph } = await import("../lib/generate/workflows/cinematic.ts");

const registry = JSON.parse(readFileSync(new URL("../data/models.json", import.meta.url), "utf8"));
const models = registry.models ?? registry;
const cinematicModels = models.filter((model) => model.modes.includes("cinematic"));

const SOURCES = { imageName: "smoke.png", endImageName: "smoke.png", audioName: "smoke.wav", videoName: "smoke.mp4" };
const UNRELATED_MODEL = "wan22-t2v";
const UNRELATED_REFUSAL = `the ${UNRELATED_MODEL} graph needs a GPU the pool does not have`;
const GRAPH_REQUEST = { mode: "cinematic", prompt: "a lighthouse at dusk", durationS: 1, seed: 1 };

/** The message the real cinematic graph builder throws for these inputs, or undefined when it builds. */
function realRefusal(modelId, params) {
  try {
    cinematicGraph({ ...GRAPH_REQUEST, modelId, params });
    return undefined;
  } catch (error) {
    return error.message;
  }
}

/** What the server answers for one request: the real builder's own message, or undefined when it builds. */
function refusalFor(request) {
  const { mode, modelId, params } = request;
  if (modelId === UNRELATED_MODEL) return UNRELATED_REFUSAL;
  return mode === "cinematic" ? realRefusal(modelId, params) : undefined;
}

let server;
let base;
const received = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push(`${req.method} ${req.url}`);
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/status") return res.end(JSON.stringify({ generation: "cloud", comfy: { origin: "https://fake.invalid" } }));
      if (req.url !== "/api/generate/graph") return res.writeHead(404).end("{}");
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      received.push(request);
      const refusal = refusalFor(request);
      if (refusal !== undefined) return res.writeHead(400).end(JSON.stringify({ error: refusal }));
      return res.end(JSON.stringify({ graph: { nodes: {} } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const cinematicRows = (plan) => plan.filter((run) => run.label.startsWith("cinematic/"));

test("cinematic plans a row for every cinematic model", async () => {
  const plan = await planRuns(base, models, SOURCES);
  const labels = cinematicRows(plan).map((run) => run.label);
  assert.deepEqual(labels.toSorted(), cinematicModels.map((model) => `cinematic/${model.id}`).toSorted());
});

test("a model that refuses the last frame is planned without it, and Hunyuan 1.5 without any frame", async () => {
  const rows = cinematicRows(await planRuns(base, models, SOURCES));
  const byModel = Object.fromEntries(rows.map((run) => [run.model?.id ?? run.label.split("/").pop(), run]));

  assert.equal(byModel["wan22-i2v"].request.params.endImageName, "smoke.png", "a model that takes both frames keeps them");
  for (const id of ["ltx-2", "ltx-25"]) {
    assert.equal(byModel[id].refusal, undefined, id);
    assert.equal("endImageName" in byModel[id].request.params, false, `${id} must not carry a last frame`);
    assert.equal(byModel[id].request.params.imageName, "smoke.png", `${id} keeps its first frame`);
  }
  assert.equal(byModel["hunyuan-15"].refusal, undefined);
  assert.equal("endImageName" in byModel["hunyuan-15"].request.params, false);
  assert.equal("imageName" in byModel["hunyuan-15"].request.params, false);
  assert.equal(byModel["hunyuan-15"].request.params.audioName, "smoke.wav", "only the frames are dropped");
});

test("each narrowing pattern matches what the real cinematic graph builder throws", () => {
  const frames = { imageName: "smoke.png", endImageName: "smoke.png" };
  const triggers = {
    endImageName: [
      ["ltx-2", frames], // end image on a model without end-frame support
      ["ltx-25", frames],
      ["hunyuan-15", frames],
    ],
    imageName: [["hunyuan-15", { imageName: "smoke.png" }]], // source image on a text-only model
  };

  assert.deepEqual(NARROWINGS.map((narrowing) => narrowing.drop).toSorted(), Object.keys(triggers).toSorted(), "every narrowing has a trigger");
  for (const { drop, refusal } of NARROWINGS) {
    for (const [modelId, params] of triggers[drop]) {
      const message = realRefusal(modelId, params);
      assert.notEqual(message, undefined, `${modelId} must refuse ${Object.keys(params)}`);
      assert.match(message, refusal, `${modelId}: ${message}`);
    }
  }
  assert.equal(realRefusal("wan22-i2v", frames), undefined, "a model that takes both frames builds");
});

test("a refusal that is not about the inputs is final and shows with its text", async () => {
  received.length = 0;
  const rows = cinematicRows(await planRuns(base, models, SOURCES));
  const refused = rows.filter((run) => run.refusal !== undefined);

  assert.deepEqual(refused.map((run) => ({ label: run.label, refusal: run.refusal })), [{ label: `cinematic/${UNRELATED_MODEL}`, refusal: UNRELATED_REFUSAL }]);
  const attempts = received.filter((entry) => typeof entry === "object" && entry.modelId === UNRELATED_MODEL);
  assert.equal(attempts.length, 1, "no narrower retry after an unrelated refusal");
});

test("other modes still plan one run on the cheapest model that builds", async () => {
  const plan = await planRuns(base, models, SOURCES);
  const reshoot = plan.filter((run) => run.label.startsWith("reshoot/"));
  assert.deepEqual(reshoot.map((run) => run.label), ["reshoot/qwen-image"]);
});

test("importing the script starts no run; executing it with --dry-run prints the plan and renders nothing", async () => {
  received.length = 0;
  const script = fileURLToPath(new URL("../scripts/cloud-smoke.mjs", import.meta.url));
  const { stdout } = await new Promise((resolve, reject) => {
    execFile(process.execPath, [script, "--dry-run", "--base", base], { timeout: 60_000 }, (error, out, err) =>
      error ? reject(Object.assign(error, { stderr: err })) : resolve({ stdout: out }),
    );
  });

  for (const model of cinematicModels) assert.match(stdout, new RegExp(`cinematic/${model.id}\\b`));
  assert.match(stdout, new RegExp(`cinematic/${UNRELATED_MODEL} +refused before submit: ${UNRELATED_REFUSAL}`));
  assert.deepEqual(
    received.filter((entry) => typeof entry === "string" && !["GET /api/status", "POST /api/generate/graph"].includes(entry)),
    [],
    "a dry run only checks graphs",
  );
});
