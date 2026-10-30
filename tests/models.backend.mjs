/**
 * GET /api/models: the registry the studio (web/) maps its model picks onto, and one default per
 * mode that the registry itself says serves that mode.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { startServer } from "./lib/server.mjs";

let app;
before(async () => {
  app = await startServer();
});
after(() => app?.stop());

test("the registry matches data/models.json and every mode has a default that serves it", async () => {
  const response = await fetch(`${app.base}/api/models`);
  assert.equal(response.status, 200);
  const body = await response.json();

  const file = JSON.parse(await readFile(new URL("../data/models.json", import.meta.url), "utf8"));
  const rows = Array.isArray(file) ? file : file.models;
  assert.deepEqual(
    body.models.map((m) => m.id).sort(),
    rows.map((m) => m.id).sort(),
  );

  for (const model of body.models) {
    assert.equal(typeof model.maxDurationS, "number", model.id);
    assert.ok(Array.isArray(model.modes) && model.modes.length > 0, model.id);
  }

  for (const [mode, id] of Object.entries(body.defaults)) {
    const model = body.models.find((m) => m.id === id);
    assert.ok(model, `${mode} default ${id} must be in the registry`);
    assert.ok(model.modes.includes(mode), `${id} must serve ${mode}`);
  }
  assert.ok(body.defaults.cinematic, "cinematic has a default");
});
