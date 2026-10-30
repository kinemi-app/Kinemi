/**
 * B2 contract: GET /api/status reports the runtime configuration without leaking a key, and the
 * generation mode follows COMFY_URL / GENERATION_MODE. Each case starts its own production server
 * with a clean environment.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer } from "./lib/server.mjs";

const ENDPOINT = "http://127.0.0.1:8188/backend/path?token=query-secret";
const ORIGIN = "http://127.0.0.1:8188";
const AUTH_VALUE = "comfy-test-value-7f3a";

async function status(settings) {
  const app = await startServer(settings);
  try {
    const response = await fetch(`${app.base}/api/status`);
    assert.equal(response.status, 200);
    return await response.json();
  } finally {
    app.stop();
  }
}

test("with no endpoint the status reports demo mode and no Comfy configuration", async () => {
  const body = await status({ env: { GENERATION_MODE: "auto" } });

  assert.equal(body.generation, "demo");
  assert.equal(body.mode, "auto");
  assert.equal(body.comfy.configured, false);
  assert.equal(body.comfy.origin, "");
  assert.equal(body.comfy.hasKey, false);
  assert.equal(typeof body.models, "number");
  assert.ok(body.models > 0, "the models count should come from the registry");
});

test("an endpoint and a key report cloud mode without exposing the key", async () => {
  const app = await startServer({ comfyUrl: ENDPOINT, env: { COMFY_API_KEY: AUTH_VALUE } });
  try {
    const response = await fetch(`${app.base}/api/status`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.ok(!text.includes(AUTH_VALUE), "the status must never carry the key");

    const body = JSON.parse(text);
    assert.equal(body.generation, "cloud");
    assert.equal(body.comfy.configured, true);
    assert.equal(body.comfy.origin, ORIGIN, "the origin must drop the path and query");
    assert.equal(body.comfy.hasKey, true);
  } finally {
    app.stop();
  }
});

test("GENERATION_MODE=local keeps demo mode even with an endpoint configured", async () => {
  const body = await status({
    comfyUrl: "http://127.0.0.1:8188",
    env: { GENERATION_MODE: "local" },
  });

  assert.equal(body.mode, "local");
  assert.equal(body.comfy.configured, true);
  assert.equal(body.generation, "demo");
});
