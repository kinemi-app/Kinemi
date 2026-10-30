// Every graph the server can send must name node types, inputs and model files that Comfy Cloud
// really has, so a paid run never spends credit on a graph Cloud can only refuse.
// The fixture is a trimmed copy of https://cloud.comfy.org/api/object_info (see its `fetched` date):
// every node name, the input names of the node families our graphs use, and the file lists of the
// model loaders. Refresh it when Cloud's library changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import "./lib/ts-resolve.mjs";

const { graphFor } = await import("../lib/generate/workflows/index.ts");

const cloud = JSON.parse(readFileSync(new URL("./fixtures/cloud-object-info.json", import.meta.url), "utf8"));
const registry = JSON.parse(readFileSync(new URL("../data/models.json", import.meta.url), "utf8"));
const models = registry.models ?? registry;

/** Every source and option a graph module may ask for, so no combination is skipped for a missing field. */
const BASE_PARAMS = {
  imageName: "kinemi-probe.png",
  endImageName: "kinemi-probe-2.png",
  videoName: "kinemi-probe.mp4",
  audioName: "kinemi-probe.wav",
  consent: true,
  language: "es",
  speaker: "Ana",
  fps: 30,
  deflicker: 0,
  sourceDurationS: 2,
};

const VARIANTS = {
  // dub into "es" (BASE_PARAMS) is refused on Cloud; dub into English is the Cloud graph to check
  audio: ["voiceover", "clone", "swap", "dub", "scene", "sfx"].map((feature) => ({ feature })).concat([{ feature: "dub", language: "en" }]),
  ads: ["product", "hooks", "posters", "ugc", "unboxing", "tutorial"].map((feature) => ({ feature })),
  fashion: ["swap", "match", "campaign"].map((feature) => ({ feature })),
  upscale: [{ factor: 2 }, { factor: 4 }],
};

/**
 * Narrower inputs for models that refuse some: LTX refuses a last frame, Hunyuan 1.5 (text-to-video
 * only) any image. Without these the sweep would skip them silently.
 */
const without = (params, ...names) => Object.fromEntries(Object.entries(params).filter(([name]) => !names.includes(name)));
const NO_LAST_FRAME = without(BASE_PARAMS, "endImageName");
const TEXT_ONLY = without(BASE_PARAMS, "endImageName", "imageName");

/**
 * The only reasons a combination may be refused before submit. Anything else that throws is a
 * broken builder and fails the sweep, instead of quietly leaving the graph unchecked.
 */
const EXPECTED_REFUSALS = [
  /^the \w+ feature runs on "[^"]+", not "/, // an audio panel is pinned to one model
  /^ads needs a (image|video) model here/, // an ads feature asks for the other kind of model
  /^the sfx feature can't run on Comfy Cloud/, // Cloud has no AudioGen or AudioMatch node
  /^the dub feature can't run into "es" on Comfy Cloud/, // Cloud translates speech into English only
];

/** Refusals that mean "try narrower inputs"; any other error is reported as it is. */
const NARROWER_INPUTS = [/takes a first frame, not a last frame$/, /has no image-to-video graph in this build$/];

/** The graph for one combination, with a last frame where the model takes one, or the first error. */
function buildOne(mode, model, extra) {
  let firstError;
  for (const base of [BASE_PARAMS, NO_LAST_FRAME, TEXT_ONLY]) {
    try {
      return { graph: graphFor({ mode, modelId: model.id, prompt: "probe", durationS: 1, seed: 1, params: { ...base, ...extra } }, "cloud") };
    } catch (error) {
      firstError ??= error;
      if (!NARROWER_INPUTS.some((reason) => reason.test(error.message))) return { error };
    }
  }
  return { error: firstError };
}

/** Every graph the registry can build, and every combination refused for a reason not on the list. */
function buildAll() {
  const built = [];
  const unexpected = [];
  for (const model of models) {
    for (const mode of model.modes ?? []) {
      for (const extra of VARIANTS[mode] ?? [{}]) {
        const variant = extra.feature ?? (extra.factor ? `x${extra.factor}` : "");
        const label = [mode, extra.language ? `${variant}(${extra.language})` : variant, model.id].filter(Boolean).join("/");
        const { graph, error } = buildOne(mode, model, extra);
        if (graph !== undefined) built.push({ label, graph });
        else if (!EXPECTED_REFUSALS.some((reason) => reason.test(error.message))) unexpected.push(`${label}: ${error.message}`);
      }
    }
  }
  return { built, unexpected };
}

/** A string input Cloud only accepts from a list: a model file, or a fixed option such as a task. */
function allowedValues(classType, input) {
  return cloud.files[`${classType}.${input}`] ?? cloud.options[`${classType}.${input}`];
}

/** What Cloud would reject in one graph: unknown nodes, unknown inputs, values outside its lists. */
function cloudMisses(graph) {
  const misses = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    const spec = cloud.nodes[node.class_type];
    if (spec === undefined) {
      misses.push(`node ${id}: ${node.class_type} is not on Cloud`);
      continue;
    }
    const known = new Set([...(spec.required ?? []), ...(spec.optional ?? [])]);
    for (const name of spec.required ?? []) {
      if (!(name in (node.inputs ?? {}))) misses.push(`node ${id}: ${node.class_type} needs input ${name}`);
    }
    for (const [name, value] of Object.entries(node.inputs ?? {})) {
      if (spec.required !== undefined && !known.has(name)) misses.push(`node ${id}: ${node.class_type} has no input ${name}`);
      const allowed = allowedValues(node.class_type, name);
      if (allowed !== undefined && typeof value === "string" && !allowed.includes(value)) {
        misses.push(`node ${id}: ${node.class_type}.${name} = ${value} is not on Cloud`);
      }
    }
  }
  return misses;
}

const { built: graphs, unexpected } = buildAll();

test("every combination builds, or is refused for a listed reason", () => {
  assert.deepEqual(unexpected, [], `graphs that threw for an unlisted reason:\n${unexpected.join("\n")}`);
  assert.ok(graphs.some(({ label }) => label === "audio/dub(en)/chatterbox"), "the Cloud dub graph into English was not built");
});

test("the registry builds a graph for every mode a tool renders in", () => {
  const modes = new Set(graphs.map(({ label }) => label.split("/")[0]));
  for (const mode of ["cinematic", "reshoot", "genjutsu", "soul", "edit", "audio", "ads", "fashion", "upscale"]) {
    assert.ok(modes.has(mode), `no graph built for ${mode}`);
  }
  // a model whose graph throws is skipped by the sweep; every cinematic model must be in it
  for (const model of models.filter(({ modes: served }) => (served ?? []).includes("cinematic"))) {
    assert.ok(graphs.some(({ label }) => label === `cinematic/${model.id}`), `cinematic/${model.id} was skipped`);
  }
});

test("every graph names only nodes, inputs and model files Comfy Cloud has", () => {
  const report = graphs
    .map(({ label, graph }) => ({ label, misses: cloudMisses(graph) }))
    .filter(({ misses }) => misses.length > 0)
    .map(({ label, misses }) => `${label}\n  ${misses.join("\n  ")}`);
  assert.equal(report.length, 0, `graphs Cloud would refuse:\n${report.join("\n")}`);
});

/** Every node type the audio feature's graphs use on one target, across the registry's audio models. */
function audioNodes(feature, target, extra = {}) {
  const types = new Set();
  for (const model of models.filter(({ modes }) => (modes ?? []).includes("audio"))) {
    try {
      const params = { ...BASE_PARAMS, feature, ...extra };
      for (const [name, value] of Object.entries(extra)) if (value === undefined) delete params[name];
      const request = { mode: "audio", modelId: model.id, prompt: "probe", durationS: 1, seed: 1, params };
      for (const node of Object.values(graphFor(request, target).nodes)) types.add(node.class_type);
    } catch {
      // this model doesn't serve the feature
    }
  }
  return types;
}

test("a local ComfyUI keeps Chatterbox voiceover, translated dubs and AudioGen effects", () => {
  // sfx with a reference clip runs AudioMatch instead; AudioGen is the prompt-only path
  const promptOnly = { audioName: undefined };
  for (const [feature, node, extra] of [["voiceover", "ChatterboxTTS", {}], ["dub", "TranslateText", {}], ["sfx", "AudioGen", promptOnly]]) {
    assert.ok(audioNodes(feature, "local", extra).has(node), `local ${feature} lost ${node}`);
    assert.ok(!audioNodes(feature, "cloud", extra).has(node), `cloud ${feature} still sends ${node}`);
  }
});

/** Snapshot of 76790d5's local audio graphs; only the voiceover entry changed, from Kokoro to Chatterbox. */
const LOCAL_AUDIO = JSON.parse(readFileSync(new URL("./fixtures/local-audio-graphs.json", import.meta.url), "utf8"));
const LOCAL_AUDIO_PARAMS = { videoName: "kinemi-probe.mp4", audioName: "kinemi-probe.wav", consent: true, language: "fr", speaker: "Ana", voice: "deep", speed: 1.2 };
const LOCAL_AUDIO_CASES = [
  ["voiceover", "voiceover", "chatterbox", {}],
  ["clone", "clone", "chatterbox", {}],
  ["swap", "swap", "chatterbox", {}],
  ["dub", "dub", "chatterbox", {}],
  ["scene", "scene", "chatterbox", {}],
  ["sfx", "sfx", "audiogen-medium", {}],
  ["sfx-prompt-only", "sfx", "audiogen-medium", { audioName: undefined }],
];

/**
 * The one deliberate change from 76790d5: ComfyUI's core LoadVideo takes `file`, so 76790d5's
 * `video` input was rejected by every ComfyUI. Only swap and dub load a video, as node 1.
 */
const LOAD_VIDEO_INPUT_RENAME = { graphs: ["swap", "dub"], node: "1", from: "video", to: "file" };

function withLoadVideoRename(key, snapshot) {
  if (!LOAD_VIDEO_INPUT_RENAME.graphs.includes(key)) return snapshot;
  const { node, from, to } = LOAD_VIDEO_INPUT_RENAME;
  const copy = structuredClone(snapshot);
  const loader = copy.nodes[node];
  assert.equal(loader.class_type, "LoadVideo", `${key} node ${node} is not LoadVideo`);
  assert.ok(from in loader.inputs, `${key} snapshot has no LoadVideo.${from} to rename`);
  loader.inputs = { [to]: loader.inputs[from] };
  return copy;
}

test("the local audio snapshot covers all seven graphs", () => {
  assert.deepEqual(Object.keys(LOCAL_AUDIO).sort(), LOCAL_AUDIO_CASES.map(([key]) => key).sort());
  assert.equal(LOCAL_AUDIO_CASES.length, 7);
});

test("each local audio graph is exactly the one 76790d5 sent, except the LoadVideo rename and the Chatterbox voiceover", () => {
  for (const [key, feature, modelId, extra] of LOCAL_AUDIO_CASES) {
    const params = { ...LOCAL_AUDIO_PARAMS, feature, ...extra };
    for (const [name, value] of Object.entries(extra)) if (value === undefined) delete params[name];
    const graph = graphFor({ mode: "audio", modelId, prompt: "a door creaks open", durationS: 3, seed: 7, params }, "local");
    assert.deepEqual(graph, withLoadVideoRename(key, LOCAL_AUDIO[key]), `local ${key} graph changed`);
  }
});

test("the Cloud check catches a missing node, a missing model file and an unknown option", () => {
  const bad = {
    nodes: {
      1: { class_type: "KinemiNoSuchNode", inputs: {} },
      2: { class_type: "UNETLoader", inputs: { unet_name: "kinemi-missing.safetensors", weight_dtype: "default" } },
      3: { class_type: "AudioSpeechToTextWhisper", inputs: { audio: [1, 0], model_size: "medium", language: "Auto-Detect", task: "Translate to Klingon" } },
    },
  };
  const misses = cloudMisses(bad);
  assert.ok(misses.some((line) => line.includes("KinemiNoSuchNode is not on Cloud")), misses.join("; "));
  assert.ok(misses.some((line) => line.includes("kinemi-missing.safetensors is not on Cloud")), misses.join("; "));
  assert.ok(misses.some((line) => line.includes("task = Translate to Klingon is not on Cloud")), misses.join("; "));
});
