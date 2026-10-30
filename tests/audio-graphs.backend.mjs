// The Audio Studio graphs, built in-process: each feature runs on nodes Comfy Cloud has, and a
// feature Cloud cannot run is refused with its name before a run exists. No server or build needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import "./lib/ts-resolve.mjs";

const { graph } = await import("../lib/generate/workflows/audio-cloud.ts");
const { graph: localGraph } = await import("../lib/generate/workflows/audio.ts");

function build(modelId, params, prompt = "The rain has not stopped.", builder = graph) {
  return builder({ mode: "audio", modelId, prompt, durationS: 3, seed: 7, params }).nodes;
}

function nodeOf(nodes, classType) {
  return Object.values(nodes).find((node) => node.class_type === classType);
}

function classes(nodes) {
  return Object.values(nodes).map((node) => node.class_type);
}

test("voiceover speaks the script with Chatterbox and saves audio", () => {
  const nodes = build("chatterbox", { feature: "voiceover" });
  const speech = nodeOf(nodes, "FL_ChatterboxTTS");
  assert.equal(speech?.inputs.text, "The rain has not stopped.");
  assert.equal(speech?.inputs.audio_prompt, undefined, "a voiceover clones no one");
  assert.ok(classes(nodes).includes("SaveAudio"));
});

test("voiceover is pinned, rendered and priced as one model", () => {
  const models = JSON.parse(readFileSync(new URL("../data/models.json", import.meta.url), "utf8"));
  assert.ok(!models.some((model) => model.id === "kokoro-tts"), "the registry has no Kokoro row");
  const chatterbox = models.find((model) => model.id === "chatterbox");
  assert.ok(chatterbox?.modes.includes("audio"), "chatterbox serves the audio mode");
  assert.ok(chatterbox.creditsPerSecond > 0, "chatterbox has a price");

  for (const [target, builder] of [["cloud", graph], ["local", localGraph]]) {
    assert.throws(
      () => build("kokoro-tts", { feature: "voiceover" }, undefined, builder),
      /voiceover.*"chatterbox".*"kokoro-tts"/,
      `${target} voiceover is pinned to chatterbox`,
    );
    const types = classes(build("chatterbox", { feature: "voiceover" }, undefined, builder));
    assert.ok(types.some((type) => /Chatterbox/.test(type) && /TTS/.test(type)), `${target} voiceover speaks with a Chatterbox node`);
    assert.ok(!types.some((type) => /Kokoro/i.test(type)), `${target} voiceover has no Kokoro node`);
  }
});

test("clone feeds the uploaded sample to Chatterbox and keeps the consent rule", () => {
  const nodes = build("chatterbox", { feature: "clone", audioName: "sample.wav", consent: true });
  const sample = Object.entries(nodes).find(([, node]) => node.class_type === "LoadAudio");
  assert.equal(sample?.[1].inputs.audio, "sample.wav");
  assert.deepEqual(nodeOf(nodes, "FL_ChatterboxTTS")?.inputs.audio_prompt, [sample[0], 0]);
  assert.throws(() => build("chatterbox", { feature: "clone", audioName: "sample.wav" }), /consent/);
});

test("swap converts the clip's own speech with FL_ChatterboxVC", () => {
  const nodes = build("chatterbox", { feature: "swap", videoName: "clip.mp4", audioName: "voice.wav" });
  assert.equal(nodeOf(nodes, "LoadVideo")?.inputs.file, "clip.mp4");
  const convert = nodeOf(nodes, "FL_ChatterboxVC");
  assert.ok(Array.isArray(convert?.inputs.input_audio), "the source speech is wired in");
  assert.ok(Array.isArray(convert?.inputs.target_voice), "the target voice is wired in");
  assert.ok(classes(nodes).includes("SaveVideo"));
});

test("dub into English goes through Whisper's translation and the multilingual voice", () => {
  const nodes = build("chatterbox", { feature: "dub", videoName: "clip.mp4", language: "en" });
  assert.equal(nodeOf(nodes, "AudioSpeechToTextWhisper")?.inputs.task, "Translate to English");
  assert.equal(nodeOf(nodes, "FL_ChatterboxMultilingualTTS")?.inputs.language, "English (en)");
  assert.ok(classes(nodes).includes("SaveVideo"));
});

test("dub into a language Cloud cannot translate to is refused by name", () => {
  assert.throws(
    () => build("chatterbox", { feature: "dub", videoName: "clip.mp4", language: "fr" }),
    /dub.*"fr".*Comfy Cloud/,
  );
});

test("a scene speaker keeps one seed across lines", () => {
  const seedOf = (prompt) => nodeOf(build("chatterbox", { feature: "scene", speaker: "Mara" }, prompt), "FL_ChatterboxTTS")?.inputs.seed;
  assert.equal(typeof seedOf("One."), "number");
  assert.equal(seedOf("One."), seedOf("Two."));
});

test("sound effects are refused by name: Comfy Cloud has no AudioGen node", () => {
  assert.throws(() => build("audiogen-medium", { feature: "sfx" }), /sfx.*Comfy Cloud/);
  assert.throws(() => build("audiogen-medium", { feature: "sfx", audioName: "ref.wav" }), /sfx.*Comfy Cloud/);
});
