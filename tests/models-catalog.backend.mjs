/**
 * The studio's model catalog (web/src/app/data/models.ts) follows the server registry in
 * data/models.json: every pick names the registry model it renders on, every generator the pickers
 * can reach is offered, licences match what each vendor publishes, credit rates match the registry's,
 * and the Academy's models and cost lessons agree with them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveModel, TOOL_MODE } from "../web/src/app/data/backend-map.ts";
import { LESSONS } from "../web/src/app/data/lessons.ts";
import { MODELS, stillCost, videoCost } from "../web/src/app/data/models.ts";

const REGISTRY_MODELS = JSON.parse(readFileSync("data/models.json", "utf8"));
const REGISTRY = { models: REGISTRY_MODELS, defaults: {} };
const PICKER_MODES = [...new Set(Object.values(TOOL_MODE))];
const PICKER_KINDS = new Set(["video", "image"]);
/** Post-processing runs on its own tool's model, not on a pick from the catalog. */
const POST_MODES = new Set(["upscale", "depth"]);

/** Checked against each vendor's model card and licence file on 28 Oct 2026. */
const VENDOR_LICENCES = {
  "wan22-t2v": "Apache-2.0",
  "wan22-i2v": "Apache-2.0",
  "ltx-2": "LTX-2 Community License",
  "ltx-25": "LTX-2.x Community License",
  "hunyuan-15": "Tencent Hunyuan Community License",
  "flux-2-dev": "FLUX [dev] Non-Commercial License v2.0",
  "flux-3-klein": "FLUX Kommunity License",
  "qwen-image": "Apache-2.0",
};

const STALE_NAMES = ["LTX-Video", "FLUX.1 [dev]", "FLUX.1 Kontext"];

/** The one registry model a studio pick renders on, across every mode a tool renders in. */
function registryModelFor(pick) {
  const ids = new Set(PICKER_MODES.map((mode) => resolveModel(REGISTRY, mode, pick)?.id).filter(Boolean));
  assert.equal(ids.size, 1, `${pick} resolves to exactly one registry model, got ${[...ids].join(", ") || "none"}`);
  return REGISTRY_MODELS.find((m) => m.id === [...ids][0]);
}

const generators = REGISTRY_MODELS.filter(
  (m) => PICKER_KINDS.has(m.kind) && m.modes.some((mode) => PICKER_MODES.includes(mode) && !POST_MODES.has(mode)),
);
const familyOf = (name) => name.replace(/ (T2V|I2V)$/, "");

test("every catalog pick names the registry model it renders on", () => {
  for (const pick of MODELS) {
    const model = registryModelFor(pick.id);
    assert.ok(pick.name.startsWith(model.name), `${pick.id} is called “${pick.name}”, the registry says “${model.name}”`);
    assert.equal(pick.vendor, model.vendor, `${pick.id} vendor`);
    assert.equal(pick.kind === "video", model.kind === "video", `${pick.id} kind ${pick.kind} vs ${model.kind}`);
  }
});

test("every registry generator the pickers reach is offered in the catalog", () => {
  const offered = new Set(MODELS.map((pick) => registryModelFor(pick.id).id));
  for (const model of generators) assert.ok(offered.has(model.id), `${model.id} (${model.name}) is missing from the catalog`);
});

test("each pick carries its vendor's licence, linked to the vendor's own model card", () => {
  for (const pick of MODELS) {
    const model = registryModelFor(pick.id);
    assert.equal(pick.license.name, VENDOR_LICENCES[model.id], `${pick.id} licence`);
    assert.match(pick.license.url, /^https:\/\/huggingface\.co\/(Wan-AI|Lightricks|tencent|black-forest-labs|Qwen)\//, `${pick.id} licence link`);
  }
});

test("each pick costs its registry model's credits per second", () => {
  for (const pick of MODELS) {
    assert.equal(pick.creditsPerSecond, registryModelFor(pick.id).creditsPerSecond, `${pick.id} credits per second`);
  }
});

test("the estimator ranks models the way the registry prices them", () => {
  assert.ok(videoCost("wan-2.2", 10).credits < videoCost("ltx-video", 10).credits, "Wan 2.2 T2V is cheaper than LTX-2.5");
  assert.ok(stillCost("qwen-image", 20).credits < stillCost("flux-dev", 20).credits, "Qwen-Image is cheaper than FLUX.2 dev");
  assert.equal(videoCost("ltx-video", 10).credits, 2 * videoCost("ltx-video", 5).credits, "twice the length, twice the credits");
});

test("the Academy cost lesson's price comparison holds in the catalog", () => {
  const lesson = LESSONS.find((l) => l.id === "cost");
  const rate = (name) => MODELS.find((m) => m.name === name).creditsPerSecond;
  const video = MODELS.filter((m) => m.kind === "video");
  assert.match(lesson.body.join(" "), /LTX-2\.5 costs more than twice what Wan 2\.2 T2V does/);
  assert.ok(rate("LTX-2.5") > 2 * rate("Wan 2.2 T2V"), "LTX-2.5 costs more than twice Wan 2.2 T2V per second");
  assert.equal(Math.max(...video.map((m) => m.creditsPerSecond)), rate("LTX-2.5"), "LTX-2.5 is the dearest video model");
});

// recipes.ts imports without extensions, so plain node can't load it: its source is read instead
test("the recipes and canvas labels name no retired model, and the still node takes its catalog name", () => {
  const recipes = readFileSync("web/src/app/tools/recipes.ts", "utf8");
  for (const name of [...STALE_NAMES, "FLUX.1"]) assert.ok(!recipes.includes(name), `recipes.ts still names ${name}`);
  assert.match(recipes, /still: \{ label: `\$\{modelById\('flux-dev'\)\.name\} still`/, "the still node's label derives from the catalog");
});

test("the Academy models lesson names the registry's models and no retired ones", () => {
  const lesson = LESSONS.find((l) => l.id === "open-weights");
  const text = [...lesson.body, ...lesson.points, ...lesson.quiz.flatMap((q) => [q.q, ...q.options, q.why])].join(" ");
  for (const model of generators) assert.ok(text.includes(familyOf(model.name)), `the lesson names ${familyOf(model.name)}`);
  for (const name of STALE_NAMES) assert.ok(!text.includes(name), `the lesson still names ${name}`);
});
