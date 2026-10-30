import type { GenerateRequest } from "../../types";
import { optionalString, requireString, type WorkflowGraph } from "../pipeline";
import {
  audioOutput,
  readFeature,
  readLanguage,
  speakerSeed,
  videoOutput,
} from "./audioFeatures";
import { addNode, createGraphBuilder } from "./graph";

/**
 * The Audio Studio graphs for a local ComfyUI. The feature names match the six panels on /audio.
 * Every upload arrives as a /api/assets name, never as browser bytes. Demo mode never reaches this
 * file: the route answers with the demo tone before a graph is built.
 */

const MAX_SFX_S = 10;

/** A1: Chatterbox reads the whole script in its own voice; the panel's voice and speed don't reach it. */
function voiceoverGraph(request: GenerateRequest): WorkflowGraph {
  const builder = createGraphBuilder();
  const voice = addNode(builder, "ChatterboxTTS", {
    text: request.prompt,
    seed: request.seed ?? 0,
  });
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
  const clone = addNode(builder, "ChatterboxTTS", {
    text: request.prompt,
    audio_prompt: [sample, 0],
    seed: request.seed ?? 0,
  });
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
  const convert = addNode(builder, "ChatterboxVC", {
    source_audio: [parts, 1],
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

/** A4: transcribe, translate, speak the translation, then rebuild the clip over the same frames. */
function dubGraph(request: GenerateRequest): WorkflowGraph {
  const params = request.params;
  const videoName = requireString(params, "videoName", "dubbing needs the source video");
  const language = readLanguage(params);

  const builder = createGraphBuilder();
  const video = addNode(builder, "LoadVideo", { file: videoName });
  const parts = addNode(builder, "GetVideoComponents", { video: [video, 0] });
  const transcribe = addNode(builder, "WhisperTranscribe", { audio: [parts, 1] });
  const translate = addNode(builder, "TranslateText", {
    text: [transcribe, 0],
    target_language: language,
  });
  const speech = addNode(builder, "ChatterboxTTS", {
    text: [translate, 0],
    language,
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
  const line = addNode(builder, "ChatterboxTTS", {
    text: request.prompt,
    seed: speakerSeed(speaker),
  });
  addNode(builder, "SaveAudio", {
    audio: [line, 0],
    filename_prefix: "kinemi/audio-scene",
  });
  return audioOutput(builder);
}

/** A6: AudioGen invents the effect; a reference clip switches the run to the matching node. */
function sfxGraph(request: GenerateRequest): WorkflowGraph {
  if (request.durationS > MAX_SFX_S) {
    throw new Error(`sound effects run at most ${MAX_SFX_S}s`);
  }
  const reference = optionalString(request.params, "audioName", "");

  const builder = createGraphBuilder();
  let effect: string;
  if (reference === "") {
    effect = addNode(builder, "AudioGen", {
      prompt: request.prompt,
      duration: request.durationS,
      seed: request.seed ?? 0,
    });
  } else {
    const sample = addNode(builder, "LoadAudio", { audio: reference });
    effect = addNode(builder, "AudioMatch", {
      reference_audio: [sample, 0],
      prompt: request.prompt,
      duration: request.durationS,
      seed: request.seed ?? 0,
    });
  }
  addNode(builder, "SaveAudio", {
    audio: [effect, 0],
    filename_prefix: "kinemi/audio-sfx",
  });
  return audioOutput(builder);
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
      return sfxGraph(request);
  }
}
