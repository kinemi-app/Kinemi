/**
 * Audio Studio backend contract: every feature reaches a real Comfy graph, uploads travel as
 * /api/assets names, and the job reports the kind its graph declares. Runs against a production
 * build and a stub ComfyUI server; no GPU or live deployment is involved.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { startServer } from "./lib/server.mjs";

const VIDEO = readFileSync("tests/fixtures/edit-source.webm");

let BASE = "";
let app;
let comfy;

/** A readable WAV, so the asset route's byte sniffing sees a real audio file. */
function wavBytes(seconds = 1) {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

/**
 * The smallest Comfy the adapter needs: /prompt records the graph, /history answers with the
 * output node the graph declares, and any other POST is an asset upload.
 */
async function startComfy() {
  const prompts = [];
  const uploads = [];
  let uploadCount = 0;

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);

      if (request.method === "POST" && request.url === "/prompt") {
        const parsed = JSON.parse(body.toString());
        const id = `p${prompts.length + 1}`;
        prompts.push({ id, graph: parsed.prompt });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ prompt_id: id }));
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/history/")) {
        const id = request.url.slice("/history/".length);
        const entry = prompts.find((prompt) => prompt.id === id);
        const classes = Object.values(entry?.graph ?? {}).map((node) => node.class_type);
        let output;
        if (classes.includes("SaveAudio")) {
          output = { audio: [{ filename: `${id}.wav`, subfolder: "", type: "output" }] };
        } else if (classes.includes("SaveVideo")) {
          const video = { filename: `${id}.mp4`, subfolder: "", type: "output" };
          output = { videos: [video], gifs: [video] };
        } else {
          output = { images: [{ filename: `${id}.png`, subfolder: "", type: "output" }] };
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ [id]: { outputs: { save: output } } }));
        return;
      }

      if (request.method === "POST") {
        uploadCount += 1;
        const name = `upload-${uploadCount}.bin`;
        uploads.push({ name, bytes: body.length });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ name, subfolder: "", type: "input" }));
        return;
      }

      response.writeHead(404);
      response.end();
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    prompts,
    uploads,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function upload(bytes, fileName, type) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), fileName);
  const response = await fetch(`${BASE}/api/assets`, { method: "POST", body: form });
  assert.equal(response.status, 200, "the asset upload should be accepted");
  const body = await response.json();
  assert.equal(typeof body.name, "string", "the asset upload should return a name");
  return body.name;
}

async function waitForJob(jobId) {
  const deadline = Date.now() + 15000;
  let job;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/api/jobs/${jobId}`);
    job = await response.json();
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return job;
}

async function submit(request) {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(response.status, 202, `${request.params?.feature ?? request.mode} should start a job`);
  const { jobId } = await response.json();
  return waitForJob(jobId);
}

function lastGraph() {
  return comfy.prompts.at(-1)?.graph ?? {};
}

function classes(graph) {
  return Object.values(graph).map((node) => node.class_type);
}

function nodeOf(graph, classType) {
  return Object.values(graph).find((node) => node.class_type === classType);
}

before(async () => {
  comfy = await startComfy();
  app = await startServer({ comfyUrl: comfy.url });
  BASE = app.base;
});

after(async () => {
  app?.stop();
  await comfy?.stop();
});

test("voiceover sends a Chatterbox graph with a SaveAudio output", async () => {
  const job = await submit({
    mode: "audio",
    modelId: "chatterbox",
    prompt: "The rain has not stopped.",
    durationS: 4,
    params: { feature: "voiceover" },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "audio");

  const graph = lastGraph();
  assert.ok(classes(graph).includes("ChatterboxTTS"), "the graph should run Chatterbox");
  assert.ok(!classes(graph).some((type) => /Kokoro/i.test(type)), "the graph should have no Kokoro node");
  assert.ok(classes(graph).includes("SaveAudio"), "the graph should declare an audio output");
  assert.equal(nodeOf(graph, "ChatterboxTTS")?.inputs.text, "The rain has not stopped.");
});

test("a voiceover naming the removed kokoro-tts model is refused as an unknown model", async () => {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "audio",
      modelId: "kokoro-tts",
      prompt: "The rain has not stopped.",
      durationS: 4,
      params: { feature: "voiceover" },
    }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'unknown model "kokoro-tts"');
});

test("voice cloning sends the uploaded name, never the browser file name", async () => {
  const audioName = await upload(wavBytes(), "my-take.wav", "audio/wav");
  const job = await submit({
    mode: "audio",
    modelId: "chatterbox",
    prompt: "This is the line the sample speaks.",
    durationS: 3,
    params: { feature: "clone", audioName, consent: true },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "audio");

  const graph = lastGraph();
  assert.ok(classes(graph).includes("LoadAudio"), "the graph should load the uploaded sample");
  assert.ok(classes(graph).includes("ChatterboxTTS"), "the graph should run Chatterbox");
  assert.ok(classes(graph).includes("SaveAudio"), "the graph should declare an audio output");
  assert.equal(nodeOf(graph, "LoadAudio")?.inputs.audio, audioName);
  assert.notEqual(nodeOf(graph, "LoadAudio")?.inputs.audio, "my-take.wav");
});

test("voice cloning refuses a missing sample or missing consent", async () => {
  const noSample = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "audio",
      modelId: "chatterbox",
      prompt: "A line.",
      durationS: 3,
      params: { feature: "clone", consent: true },
    }),
  });
  assert.equal(noSample.status, 502, "a clone without a sample must not start a job");
  assert.match((await noSample.json()).error, /audioName|sample/i);

  const audioName = await upload(wavBytes(), "voice.wav", "audio/wav");
  const noConsent = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "audio",
      modelId: "chatterbox",
      prompt: "A line.",
      durationS: 3,
      params: { feature: "clone", audioName },
    }),
  });
  assert.equal(noConsent.status, 502, "a clone without consent must not start a job");
  assert.match((await noConsent.json()).error, /consent/i);
});

test("voice swap loads both uploads and declares a video output", async () => {
  const videoName = await upload(VIDEO, "source.webm", "video/webm");
  const audioName = await upload(wavBytes(), "target.wav", "audio/wav");
  const job = await submit({
    mode: "audio",
    modelId: "chatterbox",
    prompt: "swap the voice in source.webm",
    durationS: 3,
    params: { feature: "swap", videoName, audioName },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");

  const graph = lastGraph();
  assert.ok(classes(graph).includes("LoadVideo"), "the graph should load the source video");
  assert.ok(classes(graph).includes("ChatterboxVC"), "the graph should run voice conversion");
  assert.ok(classes(graph).includes("CreateVideo"), "the graph should rebuild the clip");
  assert.ok(classes(graph).includes("SaveVideo"), "the graph should declare a video output");
  assert.equal(nodeOf(graph, "LoadVideo")?.inputs.file, videoName);
  assert.equal(nodeOf(graph, "LoadAudio")?.inputs.audio, audioName);
});

test("dubbing carries the target language through ASR and translation", async () => {
  const videoName = await upload(VIDEO, "source.webm", "video/webm");
  const job = await submit({
    mode: "audio",
    modelId: "chatterbox",
    prompt: "dub source.webm into French",
    durationS: 3,
    params: { feature: "dub", videoName, language: "fr" },
  });

  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "video");

  const graph = lastGraph();
  assert.ok(classes(graph).includes("WhisperTranscribe"), "dubbing needs the ASR node");
  assert.ok(classes(graph).includes("TranslateText"), "dubbing needs the translation node");
  assert.ok(classes(graph).includes("ChatterboxTTS"), "dubbing needs the voice node");
  assert.ok(classes(graph).includes("SaveVideo"), "the graph should declare a video output");
  assert.equal(nodeOf(graph, "TranslateText")?.inputs.target_language, "fr");
});

test("a scene line renders as one audio graph with a stable speaker seed", async () => {
  const request = {
    mode: "audio",
    modelId: "chatterbox",
    prompt: "The rain has not stopped.",
    durationS: 3,
    params: { feature: "scene", speaker: "Mara", speakers: 2, ambience: "rain" },
  };
  const first = await submit(request);
  assert.equal(first.status, "succeeded");
  assert.equal(first.result.kind, "audio");
  const firstSeed = nodeOf(lastGraph(), "ChatterboxTTS")?.inputs.seed;

  const second = await submit(request);
  assert.equal(second.status, "succeeded");
  assert.equal(nodeOf(lastGraph(), "ChatterboxTTS")?.inputs.seed, firstSeed);
  assert.ok(classes(lastGraph()).includes("SaveAudio"));
});

test("sound effects use AudioGen, and a reference clip switches to the matcher", async () => {
  const plain = await submit({
    mode: "audio",
    modelId: "audiogen-medium",
    prompt: "Rain on a metal roof, close, no music.",
    durationS: 3,
    params: { feature: "sfx" },
  });
  assert.equal(plain.status, "succeeded");
  assert.equal(plain.result.kind, "audio");
  assert.ok(classes(lastGraph()).includes("AudioGen"), "a plain SFX run should use AudioGen");
  assert.ok(classes(lastGraph()).includes("SaveAudio"));

  const audioName = await upload(wavBytes(), "reference.wav", "audio/wav");
  const matched = await submit({
    mode: "audio",
    modelId: "audiogen-medium",
    prompt: "Match this roof rain.",
    durationS: 3,
    params: { feature: "sfx", audioName },
  });
  assert.equal(matched.status, "succeeded");
  assert.ok(classes(lastGraph()).includes("LoadAudio"), "a matched effect should load the reference");
  assert.ok(classes(lastGraph()).includes("AudioMatch"), "a matched effect should use AudioMatch");
  assert.equal(nodeOf(lastGraph(), "LoadAudio")?.inputs.audio, audioName);
});

test("audio and upscale still answer 502 when the Comfy endpoint is unreachable", async () => {
  const remote = await startServer({ comfyUrl: "http://127.0.0.1:1" });
  const requests = [
    {
      workflow: "audio.voiceover",
      mode: "audio",
      modelId: "chatterbox",
      prompt: "A line for the failure path.",
      durationS: 3,
      params: { feature: "voiceover" },
    },
    {
      workflow: "audio.sfx",
      mode: "audio",
      modelId: "audiogen-medium",
      prompt: "Rain on a roof for the failure path.",
      durationS: 3,
      params: { feature: "sfx" },
    },
    {
      workflow: "upscale",
      mode: "upscale",
      modelId: "realesrgan-x4",
      prompt: "A clip for the failure path.",
      durationS: 3,
      params: {
        factor: 4,
        fps: 60,
        deflicker: 0,
        sourceDurationS: 3,
        videoName: "upload-1.bin",
      },
    },
  ];

  try {
    for (const { workflow, ...request } of requests) {
      const response = await fetch(`${remote.base}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      assert.equal(response.status, 502, `${request.mode} should answer 502 when Comfy is down`);
      const body = await response.json();
      assert.match(body.error, /could not be reached/i);
      assert.ok(
        body.error.includes(workflow),
        `the 502 for ${request.mode} should name the ${workflow} workflow`,
      );
    }
  } finally {
    remote.stop();
  }
});
