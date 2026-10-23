/**
 * AC6: POST /api/generate answers 202 with a job id, polling GET /api/jobs/:id reaches
 * "succeeded" and carries a result URL. Also AC6 of T-0044: every flow page answers 200 with its
 * own <h1> on the production build. Runs against a real build on a spare port.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { startServer } from "./lib/server.mjs";

const execFileAsync = promisify(execFile);
const CLI = "bin/kinemi.mjs";
const PLAN_BRIEF = "A desk lamp that charges your phone";

let BASE = "";
let studio;

before(async () => {
  studio = await startServer();
  BASE = studio.base;
});

after(() => {
  studio?.stop();
});

test("generate then poll to succeeded", async () => {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "cinematic",
      modelId: "wan22-t2v",
      prompt: "a lighthouse in heavy fog, slow push in",
      durationS: 3,
    }),
  });
  assert.equal(response.status, 202);

  const { jobId } = await response.json();
  assert.equal(typeof jobId, "string");

  let job;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const poll = await fetch(`${BASE}/api/jobs/${jobId}`);
    assert.equal(poll.status, 200);
    job = await poll.json();
    if (job.status === "succeeded" || job.status === "failed") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  assert.equal(job?.status, "succeeded");
  assert.equal(job?.demo, true);
  assert.equal(typeof job?.result?.url, "string");
  assert.equal(job?.result?.kind, "image");
});

test("a request naming an unknown model is refused", async () => {
  const response = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "cinematic", modelId: "not-a-model", prompt: "x", durationS: 3 }),
  });
  assert.equal(response.status, 400);
});

test("an unknown job id answers 404", async () => {
  const response = await fetch(`${BASE}/api/jobs/does-not-exist`);
  assert.equal(response.status, 404);
});

function postPlan(brief) {
  return fetch(`${BASE}/api/studio/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief }),
  });
}

test("the planner answers six shots and refuses a brief with no subject", async () => {
  assert.equal((await postPlan("a lamp")).status, 400, "a short brief should be refused");
  assert.equal((await postPlan("!!!!!!!!!!!!")).status, 400, "punctuation alone leaves no subject");

  const response = await postPlan(PLAN_BRIEF);
  assert.equal(response.status, 200);

  const { shots } = await response.json();
  assert.equal(shots.length, 6);
  for (const [at, shot] of shots.entries()) {
    assert.equal(shot.index, at + 1);
    assert.equal(typeof shot.title, "string");
    assert.equal(typeof shot.mode, "string");
    assert.equal(typeof shot.modelId, "string");
    assert.ok(shot.durationS > 0);
    assert.ok(shot.prompt.endsWith(PLAN_BRIEF), `shot ${shot.index} should carry the brief subject`);
  }
});

test("the CLI plans a campaign and lists schedules against a temporary home", async () => {
  const home = await mkdtemp(join(tmpdir(), "kinemi-cli-"));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    const planPath = join(home, "plan.json");
    const planned = await execFileAsync(
      process.execPath,
      [CLI, "plan", "--brief", PLAN_BRIEF, "--base", BASE, "--out", planPath],
      { env },
    );
    assert.match(planned.stdout, /6 shots written/);
    assert.match(planned.stdout, /1\. Hook · ads · 3s · wan22-i2v/);

    const shots = JSON.parse(await readFile(planPath, "utf8"));
    assert.equal(shots.length, 6);

    const listed = await execFileAsync(process.execPath, [CLI, "schedule", "list"], { env });
    assert.ok(listed.stdout.includes(join(home, ".kinemi", "schedules.json")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a corrupt schedules file is reported and left alone", async () => {
  const home = await mkdtemp(join(tmpdir(), "kinemi-cli-"));
  const directory = join(home, ".kinemi");
  const schedules = join(directory, "schedules.json");
  const corrupt = "{ not json";
  await mkdir(directory, { recursive: true });
  await writeFile(schedules, corrupt);
  const env = { ...process.env, HOME: home, USERPROFILE: home };

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [CLI, "schedule", "list"], { env }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /schedules\.json is not valid JSON/);
        return true;
      },
    );
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [CLI, "schedule", "add", "--cron", "0 9 * * *", "--plan", join(home, "plan.json")],
        { env },
      ),
      (error) => {
        assert.equal(error.code, 1);
        return true;
      },
    );
    assert.equal(await readFile(schedules, "utf8"), corrupt, "add must not overwrite the corrupt file");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

const FLOW_PAGES = [
  { path: "/cinematic", heading: "Cinematic" },
  { path: "/storyboard", heading: "Storyboard" },
  { path: "/reshoot", heading: "Re-shoot" },
  { path: "/genjutsu", heading: "Genjutsu" },
  { path: "/presets", heading: "Presets" },
  { path: "/soul", heading: "Soul" },
  { path: "/cast", heading: "AI Cast" },
  { path: "/edit", heading: "Edit" },
  { path: "/academy", heading: "Academy" },
  { path: "/audio", heading: "Audio Studio" },
  { path: "/ads", heading: "Marketing Studio" },
  { path: "/fashion", heading: "Fashion Factory" },
  { path: "/studio", heading: "Supercomputer" },
  { path: "/upscale", heading: "Upscale" },
];

test("the fourteen flow pages render their own heading on the production build", async () => {
  for (const page of FLOW_PAGES) {
    const response = await fetch(`${BASE}${page.path}`);
    assert.equal(response.status, 200, `${page.path} should answer 200`);

    const html = await response.text();
    const main = html.match(/<main[\s>][\s\S]*?<\/main>/);
    assert.ok(main, `${page.path} should render a <main>`);

    const heading = main[0].match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    assert.ok(heading, `${page.path} should render an <h1> inside <main>`);

    const text = heading[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    assert.equal(text, page.heading, `${page.path} should head its own flow`);
  }
});

const NEW_MODES = [
  { mode: "audio", modelId: "kokoro-tts", durationS: 1, kind: "audio" },
  { mode: "ads", modelId: "wan22-i2v", durationS: 3, kind: "image" },
  { mode: "fashion", modelId: "flux-2-dev", durationS: 1, kind: "image" },
  { mode: "upscale", modelId: "realesrgan-x4", durationS: 3, kind: "image" },
];

test("the four studio modes are accepted and reach a result", async () => {
  const submitted = [];

  for (const entry of NEW_MODES) {
    const response = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: entry.mode,
        modelId: entry.modelId,
        prompt: `a test run for ${entry.mode}`,
        durationS: entry.durationS,
      }),
    });
    assert.equal(response.status, 202, `${entry.mode} should be accepted`);
    const { jobId } = await response.json();
    submitted.push({ entry, jobId });
  }

  const deadline = Date.now() + 15000;
  for (const { entry, jobId } of submitted) {
    let job;
    while (Date.now() < deadline) {
      const poll = await fetch(`${BASE}/api/jobs/${jobId}`);
      job = await poll.json();
      if (job.status === "succeeded" || job.status === "failed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert.equal(job?.status, "succeeded", `${entry.mode} should succeed`);
    assert.equal(job?.result?.kind, entry.kind, `${entry.mode} should return a ${entry.kind} result`);
    if (entry.kind === "audio") {
      assert.match(job.result.url, /^data:audio\/wav;base64,/, "an audio job should return a WAV");

      // The demo WAV follows the requested length instead of always synthesizing the same clip.
      const wav = Buffer.from(job.result.url.split(",", 2)[1] ?? "", "base64");
      assert.ok(wav.length > 44, "the WAV should carry samples");
      const byteRate = wav.readUInt32LE(28);
      const dataBytes = wav.readUInt32LE(40);
      assert.ok(
        Math.abs(dataBytes / byteRate - entry.durationS) < 0.05,
        `the demo WAV should run for the requested ${entry.durationS}s`,
      );
    }
  }
});

test("audio answers 502 when the configured Comfy endpoint is unreachable", async () => {
  const remote = await startServer({ comfyUrl: "http://127.0.0.1:1" });

  try {
    const response = await fetch(`${remote.base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "audio",
        modelId: "kokoro-tts",
        prompt: "a test run for audio",
        durationS: 3,
        params: { feature: "voiceover", voice: "warm", speed: 1 },
      }),
    });
    assert.equal(response.status, 502, "audio with an unreachable endpoint should answer 502");
    const body = await response.json();
    assert.match(body.error, /could not be reached/i);
    assert.match(body.error, /audio\.voiceover/, "the 502 should name the audio.voiceover workflow");
  } finally {
    remote.stop();
  }
});
