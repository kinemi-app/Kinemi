import type { GenerateRequest } from "../../types";
import { requireString, type WorkflowGraph } from "../pipeline";
import {
  audioOutput,
  readFeature,
  readLanguage,
  speakerSeed,
  videoOutput,
} from "./audioFeatures";
import { addNode, createGraphBuilder, type GraphBuilder } from "./graph";

/**
 * The Audio Studio graphs. The feature names match the six panels on /audio. Every upload arrives
 * as a /api/assets name, never as browser bytes. Demo mode never reaches this file: the route
 * answers with the demo tone before a graph is built. Every node is one Comfy Cloud's object_info
 * lists (tests/fixtures/cloud-object-info.json); a feature Cloud has no node for throws here, so
 * no run is ever billed for a graph Cloud can only refuse.
 */

/** Chatterbox's own defaults; Cloud's FL_Chatterbox nodes require each one to be sent. */
const CHATTERBOX_SETTINGS = { exaggeration: 0.5, cfg_weight: 0.5, temperature: 0.8 };
const MULTILINGUAL_SETTINGS = { ...CHATTERBOX_SETTINGS, repetition_penalty: 2, min_p: 0.05, top_p: 1 };

/**
 * Cloud has no text-translation node; Whisper's "Translate to English" task is its only path from
 * one spoken language to another, so English is the one target a dub can reach there.
 */
const DUB_TARGET = "en";
const DUB_TARGET_LABEL = "English (en)";
const WHISPER_MODEL_SIZE = "medium";

function readDubTarget(params: GenerateRequest["params"]): void {
  const language = readLanguage(params);
  if (language !== DUB_TARGET) {
    throw new Error(
      `the dub feature can't run into "${language}" on Comfy Cloud: Cloud has no node that translates speech into it. Pick English as the target language.`,
    );
  }
}

/** One Chatterbox line; a reference sample makes it speak in that voice. */
function speak(builder: GraphBuilder, text: string, seed: number, sample?: string): string {
  return addNode(builder, "FL_ChatterboxTTS", {
    text,
    ...CHATTERBOX_SETTINGS,
    seed,
    ...(sample === undefined ? {} : { audio_prompt: [sample, 0] }),
  });
}

/**
 * A1: Chatterbox reads the whole script in its own voice. FL_ChatterboxTTS takes no voice pack
 * or speed, so the panel's voice and speed do not reach it.
 */
function voiceoverGraph(request: GenerateRequest): WorkflowGraph {
  const builder = createGraphBuilder();
  const voice = speak(builder, request.prompt, request.seed ?? 0);
  addNode(builder, "SaveAudio", {
    audio: [voice, 0],
    filename_prefix: "kinemi/audio-voiceover",
  });
  return audioOutput(builder);
}

/** A2: Chatterbox clones the uploaded sample. Consent is checked here, after the sample name. */
function cloneGraph(request: GenerateRequest): WorkflowGraph {
  const params = request.params;
  const audioName = requireString(params, "audioName", "voice cloning needs a sample upload");
  if (params?.consent !== true) {
    throw new Error(
      "voice cloning needs your consent: set params.consent to true after confirming you have the right to use this voice",
    );
  }

  const builder = createGraphBuilder();
  const sample = addNode(builder, "LoadAudio", { audio: audioName });
  const clone = speak(builder, request.prompt, request.seed ?? 0, sample);
  addNode(builder, "SaveAudio", {
    audio: [clone, 0],
    filename_prefix: "kinemi/audio-clone",
  });
  return audioOutput(builder);
}

/** A3: keep the pictures and timing, replace the speech with the target voice. */
function swapGraph(request: GenerateRequest): WorkflowGraph {
  const params = request.params;
  const videoName = requireString(params, "videoName", "voice swap needs the source video");
  const audioName = requireString(params, "audioName", "voice swap needs the target voice sample");

  const builder = createGraphBuilder();
  const video = addNode(builder, "LoadVideo", { file: videoName });
  const parts = addNode(builder, "GetVideoComponents", { video: [video, 0] });
  const target = addNode(builder, "LoadAudio", { audio: audioName });
  const convert = addNode(builder, "FL_ChatterboxVC", {
    input_audio: [parts, 1],
    target_voice: [target, 0],
    seed: request.seed ?? 0,
  });
  const clip = addNode(builder, "CreateVideo", {
    images: [parts, 0],
    audio: [convert, 0],
    fps: [parts, 2],
  });
  addNode(builder, "SaveVideo", {
    video: [clip, 0],
    filename_prefix: "kinemi/audio-swap",
    format: "mp4",
    codec: "h264",
  });
  return videoOutput(builder);
}

/** A4: Whisper hears and translates in one step, Chatterbox speaks it, the clip is rebuilt. */
function dubGraph(request: GenerateRequest): WorkflowGraph {
  const params = request.params;
  const videoName = requireString(params, "videoName", "dubbing needs the source video");
  readDubTarget(params);

  const builder = createGraphBuilder();
  const video = addNode(builder, "LoadVideo", { file: videoName });
  const parts = addNode(builder, "GetVideoComponents", { video: [video, 0] });
  const translate = addNode(builder, "AudioSpeechToTextWhisper", {
    audio: [parts, 1],
    model_size: WHISPER_MODEL_SIZE,
    language: "Auto-Detect",
    task: "Translate to English",
  });
  const speech = addNode(builder, "FL_ChatterboxMultilingualTTS", {
    text: [translate, 0],
    language: DUB_TARGET_LABEL,
    ...MULTILINGUAL_SETTINGS,
    seed: request.seed ?? 0,
  });
  const clip = addNode(builder, "CreateVideo", {
    images: [parts, 0],
    audio: [speech, 0],
    fps: [parts, 2],
  });
  addNode(builder, "SaveVideo", {
    video: [clip, 0],
    filename_prefix: "kinemi/audio-dub",
    format: "mp4",
    codec: "h264",
  });
  return videoOutput(builder);
}

/** A5: the UI sends one request per line; each speaker gets a stable seed of its own. */
function sceneGraph(request: GenerateRequest): WorkflowGraph {
  const speaker = requireString(request.params, "speaker", "a scene line needs its speaker name");

  const builder = createGraphBuilder();
  const line = speak(builder, request.prompt, speakerSeed(speaker));
  addNode(builder, "SaveAudio", {
    audio: [line, 0],
    filename_prefix: "kinemi/audio-scene",
  });
  return audioOutput(builder);
}

/** A6: AudioGen and AudioMatch are not on Comfy Cloud, so an effect is refused before a run. */
function refuseSfx(): never {
  throw new Error(
    "the sfx feature can't run on Comfy Cloud: Cloud has no AudioGen or AudioMatch node. Sound effects are off until they move to a model Cloud runs.",
  );
}

/** The registry has one entry point; the feature picker is the only branch inside the mode. */
export function graph(request: GenerateRequest): WorkflowGraph {
  switch (readFeature(request)) {
    case "voiceover":
      return voiceoverGraph(request);
    case "clone":
      return cloneGraph(request);
    case "swap":
      return swapGraph(request);
    case "dub":
      return dubGraph(request);
    case "scene":
      return sceneGraph(request);
    case "sfx":
      return refuseSfx();
  }
}
