/**
 * B7 contract: a configured cloud LLM plans the campaign, and any unusable answer falls back to
 * the deterministic template. A local stub stands in for the LLM; no cloud call is made.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { startServer } from "./lib/server.mjs";

const MODEL = "stub-planner-1";
const KEY = "test-llm-key-4b1c";
const BRIEF = "a ceramic pour-over set for slow mornings";

const MODEL_SHOTS = [
  {
    title: "Hook",
    prompt: "open on steam curling from a ceramic pour-over set",
    mode: "ads",
    modelId: "flux-2-dev",
    durationS: 1,
  },
  {
    title: "Product hero",
    prompt: "clean hero shot of the ceramic pour-over set",
    mode: "ads",
    durationS: 1,
  },
  {
    title: "Detail",
    prompt: "close detail of the glaze on the ceramic pour-over set",
    mode: "ads",
    durationS: 1,
  },
  {
    title: "Brewing",
    prompt: "a slow cinematic pour through the ceramic pour-over set",
    mode: "cinematic",
    durationS: 4,
  },
  {
    title: "Morning",
    prompt: "someone carrying the ceramic pour-over set to a window",
    mode: "cinematic",
    durationS: 3,
  },
  {
    title: "End card",
    prompt: "end card for the ceramic pour-over set",
    mode: "ads",
    durationS: 3,
  },
];

const UNKNOWN_MODE_SHOTS = MODEL_SHOTS.map((shot, index) =>
  index === 0 ? { ...shot, mode: "telepathy" } : shot,
);

/**
 * An OpenAI-compatible stub. The brief's wording picks the answer, so one running app server can
 * exercise a valid plan, malformed JSON and an unknown mode.
 */
async function startLlm() {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/chat/completions") {
        response.writeHead(404);
        response.end();
        return;
      }

      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ authorization: request.headers.authorization, body });

      const brief = body.messages.at(-1)?.content ?? "";
      let content = JSON.stringify({ shots: MODEL_SHOTS });
      if (brief.includes("unknown mode")) {
        content = JSON.stringify({ shots: UNKNOWN_MODE_SHOTS });
      } else if (brief.includes("broken json")) {
        content = "not json";
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

let llm;
let app;

async function plan(base, brief) {
  const response = await fetch(`${base}/api/studio/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief }),
  });
  return { status: response.status, body: await response.json() };
}

/** The template's own plan, used for comparison without importing the module into this process. */
async function templatePlan(base) {
  const { status, body } = await plan(base, BRIEF);
  assert.equal(status, 200);
  return body;
}

before(async () => {
  llm = await startLlm();
  app = await startServer({
    env: { LLM_URL: llm.url, LLM_MODEL: MODEL, LLM_API_KEY: KEY },
  });
});

after(async () => {
  app?.stop();
  await llm?.stop();
});

test("a configured LLM plans the campaign and its request matches the contract", async () => {
  const { status, body } = await plan(app.base, BRIEF);

  assert.equal(status, 200);
  assert.equal(body.source, "model");
  assert.equal(body.shots.length, 6);
  assert.deepEqual(body.shots[0], {
    index: 1,
    title: "Hook",
    prompt: "open on steam curling from a ceramic pour-over set",
    mode: "ads",
    modelId: "flux-2-dev",
    durationS: 1,
  });
  assert.equal(body.shots[1].modelId, "wan22-i2v", "a shot without a modelId gets the mode default");

  const request = llm.requests.at(-1);
  assert.equal(request.authorization, `Bearer ${KEY}`);
  assert.equal(request.body.model, MODEL);
  assert.equal(request.body.temperature, 0.4);
  assert.deepEqual(request.body.response_format, { type: "json_object" });
  assert.equal(request.body.messages[0].role, "system");
  assert.equal(request.body.messages[1].role, "user");
  assert.equal(request.body.messages[1].content, BRIEF);
});

test("an answer that is not JSON falls back to the six-shot template", async () => {
  const calls = llm.requests.length;
  const { status, body } = await plan(app.base, "a brief that returns broken json from the model");

  assert.equal(status, 200);
  assert.equal(body.source, "template");
  assert.equal(body.shots.length, 6);
  assert.equal(body.shots[0].title, "Hook");
  assert.ok(body.shots[0].prompt.startsWith("open on"), "the template's own prompt must survive");
  assert.equal(body.shots[0].modelId, "wan22-i2v");
  assert.equal(llm.requests.length, calls + 1, "the model must have been asked before the fallback");
});

test("a shot with an unknown mode falls back instead of reaching the batch", async () => {
  const { status, body } = await plan(app.base, "a brief with an unknown mode in the answer");

  assert.equal(status, 200);
  assert.equal(body.source, "template");
  assert.equal(body.shots.length, 6);
  assert.ok(!body.shots.some((shot) => shot.mode === "telepathy"));
});

test("without an LLM URL and model the planner stays on the template", async () => {
  const local = await startServer({ env: { LLM_URL: "", LLM_MODEL: "" } });
  try {
    const calls = llm.requests.length;
    const body = await templatePlan(local.base);

    assert.equal(body.source, "template");
    assert.equal(body.shots.length, 6);
    assert.equal(llm.requests.length, calls, "no LLM configuration must mean no LLM call");
  } finally {
    local.stop();
  }
});
