/**
 * web/src/app/tools/graph-adapter.ts: the server's API-format ComfyUI graph becomes the node layout
 * the studio's "Comfy graph" tab draws. Unit cases pin the mapping; the last test runs real graphs
 * from POST /api/generate/graph through it, so every wire lands on a node and an output that exist.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { fromApi } from "../web/src/app/tools/graph-adapter.ts";
import { startServer } from "./lib/server.mjs";

const SMALL = {
  1: { class_type: "UNETLoader", inputs: { unet_name: "wan.safetensors", weight_dtype: "default" } },
  2: { class_type: "CLIPLoader", inputs: { clip_name: "umt5.safetensors", type: "wan" } },
  3: { class_type: "CLIPTextEncode", inputs: { text: "a street", clip: ["2", 0] } },
  10: { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["3", 0], seed: 7, steps: 20 } },
  9: { class_type: "Note", inputs: {}, _meta: { title: "Read me" } },
};

test("links become typed inputs and everything else stays a widget", () => {
  const sampler = fromApi(SMALL, "small").nodes.find((n) => n.id === "10");
  assert.deepEqual(sampler.inputs, [
    { name: "model", type: "MODEL", from: ["1", 0] },
    { name: "positive", type: "CONDITIONING", from: ["3", 0] },
  ]);
  assert.deepEqual(sampler.widgets, [
    ["seed", 7],
    ["steps", 20],
  ]);
  assert.equal(sampler.type, "KSampler");
});

test("a node's outputs are what its consumers read, typed by the input that reads them", () => {
  const graph = fromApi(SMALL, "small");
  assert.deepEqual(graph.nodes.find((n) => n.id === "1").outputs, [{ name: "MODEL", type: "MODEL" }]);
  assert.deepEqual(graph.nodes.find((n) => n.id === "2").outputs, [{ name: "CLIP", type: "CLIP" }]);
  assert.deepEqual(graph.nodes.find((n) => n.id === "10").outputs, []);
});

test("an output nobody reads still gets a slot, so later indexes line up", () => {
  const graph = fromApi(
    {
      1: { class_type: "GetVideoComponents", inputs: {} },
      2: { class_type: "SaveAudio", inputs: { audio: ["1", 1] } },
    },
    "gap",
  );
  assert.deepEqual(graph.nodes[0].outputs.map((o) => o.type), ["FLOAT", "AUDIO"]);
});

test("nodes come in numeric order, keep the label and take _meta titles", () => {
  const graph = fromApi(SMALL, "Cinematic · wan22-t2v");
  assert.equal(graph.label, "Cinematic · wan22-t2v");
  assert.deepEqual(graph.nodes.map((n) => n.id), ["1", "2", "3", "9", "10"]);
  assert.equal(graph.nodes.find((n) => n.id === "9").title, "Read me");
  assert.equal(graph.nodes.find((n) => n.id === "1").title, "UNETLoader");
});

test("input names the table doesn't list fall back by what they name", () => {
  const graph = fromApi(
    {
      1: { class_type: "A", inputs: {} },
      2: { class_type: "B", inputs: { reference_audio: ["1", 0], control_video: ["1", 1], clip_vision_start_image: ["1", 2], mystery: ["1", 3], latent_image: ["1", 4] } },
    },
    "fallbacks",
  );
  assert.deepEqual(graph.nodes[1].inputs.map((i) => i.type), ["AUDIO", "IMAGE", "CLIP_VISION_OUTPUT", "FLOAT", "LATENT"]);
});

let app;
before(async () => {
  app = await startServer();
});
after(() => app?.stop());

test("real server graphs adapt with every wire landing on an existing output", async () => {
  const requests = [
    { mode: "cinematic", modelId: "wan22-t2v", prompt: "a street", durationS: 5, seed: 1, params: {} },
    { mode: "soul", modelId: "flux-2-dev", prompt: "a face", durationS: 1, seed: 1, params: {} },
    { mode: "audio", modelId: "chatterbox", prompt: "hello there", durationS: 5, seed: 1, params: { feature: "voiceover" } },
  ];
  for (const body of requests) {
    const response = await fetch(`${app.base}/api/generate/graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, `${body.mode}: ${await response.clone().text()}`);
    const { graph } = await response.json();
    const view = fromApi(graph.nodes, body.mode);
    assert.equal(view.nodes.length, Object.keys(graph.nodes).length, body.mode);
    const byId = new Map(view.nodes.map((n) => [n.id, n]));
    for (const node of view.nodes) {
      for (const input of node.inputs) {
        const source = byId.get(input.from[0]);
        assert.ok(source, `${body.mode}: #${node.id}.${input.name} reads a node that exists`);
        assert.equal(source.outputs[input.from[1]].type, input.type, `${body.mode}: #${node.id}.${input.name}`);
      }
    }
  }
});
