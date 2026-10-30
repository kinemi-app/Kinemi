/**
 * web/src/app/data/backend-request.ts: each studio tool's settings become the server's params, and
 * requestFor builds POST /api/generate's body. Unit cases pin the mappings; the last test sends
 * every tool's request through /api/generate/graph, so the server's own graph builders accept them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { audioCredits, requestFor, serverHints } from "../web/src/app/data/backend-request.ts";
import { VOICES } from "../web/src/app/data/options.ts";
import { startServer } from "./lib/server.mjs";

const [DEFAULT_VOICE, CLONED_VOICE] = VOICES;

const realModel = (id) => JSON.parse(readFileSync("data/models.json", "utf8")).find((model) => model.id === id);

const VIDEO = { id: "clip-1", kind: "video", duration: 7.4 };
const STILL = { id: "still-1", kind: "still" };
const finder = (asset) => (kinds) => (asset && kinds.includes(asset.kind) ? asset : undefined);

const REGISTRY = {
  models: [
    { id: "wan22-t2v", name: "Wan T2V", vendor: "", kind: "video", modes: ["cinematic", "ads"], maxDurationS: 5 },
    { id: "flux-2-dev", name: "FLUX", vendor: "", kind: "image", modes: ["soul", "ads", "fashion"], maxDurationS: 1 },
    realModel("chatterbox"),
  ],
  defaults: { cinematic: "wan22-t2v", ads: "flux-2-dev", audio: "chatterbox" },
};

const spec = (tool, extra = {}) => ({ tool, kind: "video", prompt: "a neon sign flickers", seed: 42, ...extra });

test("source tools name the asset to upload, and Edit maps its % strength onto 1-10", () => {
  assert.deepEqual(serverHints("reshoot", {}, finder(STILL)), { sourceId: "still-1", params: {} });
  assert.deepEqual(serverHints("genjutsu", {}, finder(VIDEO)), { sourceId: "clip-1", params: {} });
  assert.equal(serverHints("genjutsu", {}, finder(undefined)).sourceId, undefined);
  assert.deepEqual(serverHints("edit", { strength: 55 }, finder(VIDEO)).params, { strength: 6 });
  assert.equal(serverHints("edit", { strength: 0 }, finder(VIDEO)).params.strength, 1);
  assert.equal(serverHints("edit", { strength: 100 }, finder(VIDEO)).params.strength, 10);
});

test("Upscale maps target, frame rate and deflicker onto the server's factor, fps and level", () => {
  const hints = serverHints("upscale", { target: "4K", fps: "60 fps", deflicker: true }, finder(VIDEO));
  assert.deepEqual(hints, { sourceId: "clip-1", params: { factor: 4, fps: 60, deflicker: 5, sourceDurationS: 7 } });
  const plain = serverHints("upscale", { target: "2K", fps: "Off", deflicker: false }, finder(VIDEO)).params;
  assert.deepEqual([plain.factor, plain.fps, plain.deflicker], [2, 30, 0]);
  assert.equal(serverHints("upscale", { fps: "48 fps" }, finder(VIDEO)).params.fps, 48, "48 fps travels as asked");
});

test("Audio modes pick the server feature and the model its graph is pinned to", () => {
  const voiceover = serverHints("audio", { mode: "Voiceover", voice: DEFAULT_VOICE }, finder(undefined));
  assert.deepEqual(voiceover, { modelId: "chatterbox", params: { feature: "voiceover" }, sourceId: undefined });
  const cloned = serverHints("audio", { mode: "Voiceover", voice: CLONED_VOICE }, finder(undefined));
  assert.deepEqual([cloned.modelId, cloned.params.feature], ["chatterbox", "clone"]);
  const dub = serverHints("audio", { mode: "Dubbing", language: "German" }, finder(VIDEO));
  assert.deepEqual(dub, { modelId: "chatterbox", params: { feature: "dub", language: "de" }, sourceId: "clip-1" });
  assert.deepEqual(serverHints("audio", { mode: "Multi-speaker", voice: DEFAULT_VOICE }, finder(undefined)).params, {
    feature: "scene",
    speaker: DEFAULT_VOICE,
  });
  assert.equal(serverHints("audio", { mode: "Sound effects", voice: DEFAULT_VOICE }, finder(undefined)).modelId, "audiogen-medium");
});

test("Fashion and Marketing settings become the server's panel features", () => {
  assert.deepEqual(serverHints("fashion", { mode: "Campaign" }, finder(undefined)).params, { feature: "campaign" });
  assert.deepEqual(serverHints("fashion", { mode: "Swap garment", drape: true, light: false }, finder(undefined)).params, {
    feature: "match",
    keepDrape: true,
    keepLighting: false,
  });
  assert.equal(serverHints("marketing", { template: "Tutorial" }, finder(undefined)).params.feature, "tutorial");
  assert.equal(serverHints("marketing", { template: "Ad" }, finder(undefined)).params.feature, "ugc");
  assert.deepEqual(serverHints("cinematic", { model: "wan-2.2" }, finder(undefined)), { params: {} });
});

test("requestFor maps the tool to a mode, the pick to a registry model, and clamps the length", () => {
  const body = requestFor(spec("cinematic", { model: "wan-2.2", duration: 8, server: { params: {} } }), REGISTRY);
  assert.deepEqual(body, { mode: "cinematic", modelId: "wan22-t2v", prompt: "a neon sign flickers", durationS: 5, seed: 42, params: {} });
  assert.equal(requestFor(spec("academy"), REGISTRY), null);
  assert.equal(requestFor(spec("previz", { duration: 5 }), REGISTRY).mode, "cinematic", "previz renders its block-out as a shot");
  assert.throws(() => requestFor(spec("reshoot"), REGISTRY), /no model for reshoot/);
});

test("requestFor puts the upload in the field its kind fills and lets a pinned model win", () => {
  const still = requestFor(spec("cinematic", { server: { params: {} } }), REGISTRY, { name: "src.png", kind: "still" });
  assert.equal(still.params.imageName, "src.png");
  const clip = requestFor(spec("cinematic", { server: { params: {} } }), REGISTRY, { name: "src.mp4", kind: "video" });
  assert.equal(clip.params.videoName, "src.mp4");
  const audio = requestFor(spec("audio", { model: "flux-dev", duration: 20, server: { modelId: "chatterbox", params: { feature: "voiceover" } } }), REGISTRY);
  assert.deepEqual([audio.modelId, audio.durationS], ["chatterbox", 20]);
});

test("a voiceover request carries modelId chatterbox and no voice or speed, whatever the panel holds", () => {
  for (const voice of [DEFAULT_VOICE, undefined]) {
    const server = serverHints("audio", { mode: "Voiceover", voice, speed: 1.4 }, finder(undefined));
    const body = requestFor(spec("audio", { duration: 10, server }), REGISTRY);
    assert.equal(body.modelId, "chatterbox", String(voice));
    assert.deepEqual(body.params, { feature: "voiceover" }, `${voice}: no voice or speed on the wire`);
  }
  const cloned = serverHints("audio", { mode: "Voiceover", voice: CLONED_VOICE, speed: 1.4 }, finder(undefined));
  const clonedBody = requestFor(spec("audio", { duration: 10, server: cloned }), REGISTRY);
  assert.deepEqual([clonedBody.modelId, clonedBody.params], ["chatterbox", { feature: "clone" }], "a cloned voice is a clone run, still without voice or speed");
});

test("the audio estimate is the pinned model's creditsPerSecond x length, rounded up to whole credits", () => {
  const rate = realModel("chatterbox").creditsPerSecond;
  assert.equal(rate, 0.04, "the registry still prices Chatterbox at 0.04 a second");
  for (const [seconds, credits] of [[5, 1], [20, 1], [30, 2]]) {
    assert.equal(audioCredits("Voiceover", seconds), Math.max(1, Math.ceil(rate * seconds)), `voiceover ${seconds} s`);
    assert.equal(audioCredits("Voiceover", seconds), credits, `voiceover ${seconds} s`);
  }
  for (const mode of ["Voice clone", "Dubbing", "Multi-speaker"]) assert.equal(audioCredits(mode, 30), 2, `${mode} prices as Chatterbox`);
  assert.equal(audioCredits("Voiceover", 120), audioCredits("Voiceover", 30), "a length past the model's 30 s cap prices what renders");
  const sfx = realModel("audiogen-medium");
  assert.equal(audioCredits("Sound effects", 10), Math.max(1, Math.ceil(sfx.creditsPerSecond * 10)), "sound effects keep their own model's rate");
});

test("requestFor runs an ad as hooks on a still model and keeps the video feature on a video model", () => {
  const hints = { params: { feature: "tutorial" } };
  assert.equal(requestFor(spec("marketing", { model: "flux-dev", server: hints }), REGISTRY).params.feature, "hooks");
  assert.equal(requestFor(spec("marketing", { model: "wan-2.2", server: hints }), REGISTRY).params.feature, "tutorial");
});

let app;
before(async () => {
  app = await startServer();
});
after(() => app?.stop());

/** Each tool at its design defaults, with the source asset the tool would upload. */
const TOOLS = [
  ["cinematic", { model: "wan-2.2" }, { duration: 5 }],
  ["previz", {}, { duration: 5 }],
  ["soul", { model: "flux-dev" }, { kind: "character" }],
  ["reshoot", { model: "qwen-image-edit" }, { kind: "still" }, STILL, "src.png"],
  ["genjutsu", { model: "wan-2.2-i2v" }, { duration: 5 }, VIDEO, "src.mp4"],
  ["edit", { model: "wan-2.2", strength: 55 }, { duration: 5 }, VIDEO, "src.mp4"],
  ["upscale", { target: "4K", fps: "60 fps", deflicker: true }, { duration: 5 }, VIDEO, "src.mp4"],
  ["audio", { mode: "Voiceover", voice: DEFAULT_VOICE }, { kind: "audio", duration: 20 }],
  ["audio", { mode: "Multi-speaker", voice: DEFAULT_VOICE }, { kind: "audio", duration: 20 }],
  ["audio", { mode: "Sound effects", voice: DEFAULT_VOICE }, { kind: "audio", duration: 20 }],
  ["audio", { mode: "Dubbing", language: "Spanish" }, { kind: "audio", duration: 20 }, VIDEO, "src.mp4"],
  ["marketing", { model: "wan-2.2", template: "Ad" }, { duration: 8 }],
  ["marketing", { model: "flux-dev", template: "Ad" }, { kind: "still" }],
  ["fashion", { model: "flux-kontext", mode: "Swap garment", drape: true, light: true }, { kind: "still" }],
  ["fashion", { model: "flux-kontext", mode: "Campaign" }, { kind: "still" }],
];

test("the server builds a graph for every tool's request at its default settings", async () => {
  const registry = await (await fetch(`${app.base}/api/models`)).json();
  for (const [tool, values, extra, source, uploaded] of TOOLS) {
    const server = serverHints(tool, values, finder(source));
    const upload = source && { name: uploaded, kind: source.kind };
    const body = requestFor(spec(tool, { model: values.model, ...extra, server }), registry, upload);
    const response = await fetch(`${app.base}/api/generate/graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = await response.json();
    assert.equal(response.status, 200, `${tool} ${JSON.stringify(values)}: ${answer.error} (${JSON.stringify(body)})`);
    assert.ok(Object.keys(answer.graph).length > 0, `${tool}: empty graph`);
  }
});
