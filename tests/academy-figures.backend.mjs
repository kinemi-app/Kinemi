/**
 * The Academy's cost figure (web/src/app/tools/academy-figures.ts) offers only clip lengths the
 * server renders: each video pick stops at its registry model's maxDurationS in data/models.json,
 * a length kept from a longer model is clamped, and the bar's full mark is a clip that can exist.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { costCeiling, costView, VIDEO_MODELS } from "../web/src/app/tools/academy-figures.ts";
import { resolveModel } from "../web/src/app/data/backend-map.ts";
import { videoCost } from "../web/src/app/data/models.ts";

const REGISTRY = { models: JSON.parse(readFileSync("data/models.json", "utf8")), defaults: {} };
const maxSecondsOf = (pick) => resolveModel(REGISTRY, "cinematic", pick).maxDurationS;

test("no video pick offers a length past its registry model's longest clip", () => {
  for (const pick of VIDEO_MODELS) {
    const { lengths } = costView(pick.id, 5, "720p");
    assert.ok(lengths.length > 0, `${pick.id} offers a length`);
    assert.ok(Math.max(...lengths) <= maxSecondsOf(pick.id), `${pick.id} offers ${lengths.join(", ")} s, max ${maxSecondsOf(pick.id)} s`);
  }
});

test("Wan stops at 5 s, HunyuanVideo at 8 s, LTX-2.5 keeps 10 s", () => {
  assert.deepEqual(costView("wan-2.2", 5, "720p").lengths, [3, 5]);
  assert.deepEqual(costView("wan-2.2-i2v", 5, "720p").lengths, [3, 5]);
  assert.deepEqual(costView("hunyuan-video", 5, "720p").lengths, [3, 5, 8]);
  assert.deepEqual(costView("ltx-video", 5, "720p").lengths, [3, 5, 8, 10]);
});

test("a length kept from a longer model is clamped and priced at the clamp", () => {
  const wan = costView("wan-2.2", 10, "1080p");
  assert.equal(wan.seconds, 5);
  assert.deepEqual(wan.estimate, videoCost("wan-2.2", 5, "1080p"));
  const hunyuan = costView("hunyuan-video", 10, "720p");
  assert.equal(hunyuan.seconds, 8);
  assert.deepEqual(hunyuan.estimate, videoCost("hunyuan-video", 8, "720p"));
});

test("the bar's full mark is the dearest video model's longest clip at 1080p", () => {
  const ceiling = costCeiling();
  const dearest = Math.max(...VIDEO_MODELS.map((m) => m.creditsPerSecond));
  assert.equal(ceiling.model.creditsPerSecond, dearest);
  assert.equal(ceiling.seconds, maxSecondsOf(ceiling.model.id));
  assert.deepEqual(ceiling.estimate, videoCost(ceiling.model.id, ceiling.seconds, "1080p"));
  for (const pick of VIDEO_MODELS) {
    for (const seconds of costView(pick.id, 5, "1080p").lengths) {
      assert.ok(costView(pick.id, seconds, "1080p").estimate.credits <= ceiling.estimate.credits, `${pick.id} ${seconds} s fits under the bar`);
    }
  }
});
