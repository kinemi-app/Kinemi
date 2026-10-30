/**
 * F5 demo speech: with `KINEMI_TTS_CMD` set, a demo audio job returns the command's WAV as a data
 * URL; without it, the job keeps the synthesised tone. The fake command is written to a temp
 * directory, so no fixture in the repo and no real voice tool is involved.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startServer } from "./lib/server.mjs";

/** A 44-byte, silent mono WAV header: exactly the shape `speak` accepts. */
const FAKE_TTS = `import { writeSync } from "node:fs";

const wav = Buffer.alloc(44);
wav.write("RIFF", 0);
wav.writeUInt32LE(36, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(8000, 28);
wav.writeUInt16LE(1, 32);
wav.writeUInt16LE(8, 34);
wav.write("data", 36);
wav.writeUInt32LE(0, 40);
writeSync(1, wav);
`;

const AUDIO_REQUEST = {
  mode: "audio",
  modelId: "chatterbox",
  prompt: "a short demo line",
  durationS: 1,
};

let workdir = "";
let speech;

function audioJob(base) {
  return fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(AUDIO_REQUEST),
  }).then(async (response) => {
    assert.equal(response.status, 202, "an audio request should start a job");
    const { jobId } = await response.json();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const job = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
      if (job.status === "succeeded" || job.status === "failed") {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`job ${jobId} did not finish`);
  });
}

function wavBytes(url) {
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), "kinemi-tts-"));
  const script = join(workdir, "fake-tts.mjs");
  await writeFile(script, FAKE_TTS);
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
  speech = await startServer({ env: { KINEMI_TTS_CMD: command } });
});

after(async () => {
  speech?.stop();
  await rm(workdir, { recursive: true, force: true });
});

test("a configured command turns the demo into speech", async () => {
  const job = await audioJob(speech.base);
  assert.equal(job.status, "succeeded");
  assert.equal(job.result.kind, "audio");
  assert.match(job.result.url, /^data:audio\/wav;base64,/);
  assert.equal(wavBytes(job.result.url).length, 44, "the result should be the fake command's WAV");
  assert.equal(job.result.demoVoice, "command", "the job should say the command rendered it");
});

test("without a command the demo keeps its tone", async () => {
  const tone = await startServer({ env: { KINEMI_TTS_CMD: "" } });
  try {
    const job = await audioJob(tone.base);
    assert.equal(job.status, "succeeded");
    assert.equal(job.result.kind, "audio");
    assert.match(job.result.url, /^data:audio\/wav;base64,/);
    assert.ok(wavBytes(job.result.url).length > 44, "the synthesised tone carries audio samples");
    assert.equal(job.result.demoVoice, "tone", "the job should say the tone rendered it");
  } finally {
    tone.stop();
  }
});
