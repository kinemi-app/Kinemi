/**
 * D2 MP4 export contract: POST /api/export turns the browser's WebM recording into an MP4 with the
 * host's ffmpeg, and answers 501 with a usable message when that binary is missing. The conversion
 * test needs ffmpeg on PATH, or KINEMI_FFMPEG_PATH pointing at it; without one it skips with that
 * reason instead of failing, and the other tests run either way.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { startServer } from "./lib/server.mjs";

const WEBM = readFileSync("tests/fixtures/edit-source.webm");
const MISSING_FFMPEG = "/nonexistent/kinemi-test-ffmpeg";
const MP4_MAGIC_OFFSET = 4;

/** The binary the route resolves: KINEMI_FFMPEG_PATH wins, as in app/api/export/ffmpeg.ts. */
const FFMPEG = process.env.KINEMI_FFMPEG_PATH?.trim() || "ffmpeg";
const NO_FFMPEG = `ffmpeg is not available (${FFMPEG}); set KINEMI_FFMPEG_PATH or install it to run the MP4 conversion check`;
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"], { stdio: "ignore" }).status === 0;

let app;
let BASE = "";

function clipForm(bytes = WEBM) {
  const form = new FormData();
  form.append("file", new File([bytes], "kinemi-previz.webm", { type: "video/webm" }));
  return form;
}

function postClip(base, form) {
  return fetch(`${base}/api/export`, { method: "POST", body: form });
}

before(async () => {
  app = await startServer();
  BASE = app.base;
});

after(() => {
  app?.stop();
});

test(
  "converts a WebM recording to an MP4 container",
  { skip: HAS_FFMPEG ? false : NO_FFMPEG },
  async () => {
    const response = await postClip(BASE, clipForm());
    assert.equal(response.status, 200, "the host needs ffmpeg on PATH (or KINEMI_FFMPEG_PATH)");
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.match(response.headers.get("content-disposition") ?? "", /kinemi-previz\.mp4/);

    const mp4 = Buffer.from(await response.arrayBuffer());
    assert.ok(mp4.length > 0, "the answer should carry the converted clip");
    assert.equal(
      mp4.subarray(MP4_MAGIC_OFFSET, MP4_MAGIC_OFFSET + 4).toString("latin1"),
      "ftyp",
      "the answer should be an MP4 container",
    );
  },
);

test("answers 501 with a clear message when ffmpeg is missing", async () => {
  const previous = process.env.KINEMI_FFMPEG_PATH;
  process.env.KINEMI_FFMPEG_PATH = MISSING_FFMPEG;
  let server;
  try {
    server = await startServer();
  } finally {
    if (previous === undefined) {
      delete process.env.KINEMI_FFMPEG_PATH;
    } else {
      process.env.KINEMI_FFMPEG_PATH = previous;
    }
  }

  try {
    const response = await postClip(server.base, clipForm());
    assert.equal(response.status, 501);
    const body = await response.json();
    assert.match(body.error, /ffmpeg/i, "the message should name the missing binary");
    assert.match(body.error, /not installed/i, "the message should say what is wrong");
  } finally {
    server.stop();
  }
});

test("refuses bytes that are not a WebM clip", async () => {
  const response = await postClip(BASE, clipForm(Buffer.from("this is not a video")));
  assert.equal(response.status, 415);
  const body = await response.json();
  assert.match(body.error, /webm/i);
});

test("requires a non-empty multipart file field", async () => {
  const missing = await postClip(BASE, new FormData());
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /"file"/);

  const empty = new FormData();
  empty.append("file", new File([], "empty.webm", { type: "video/webm" }));
  const blank = await postClip(BASE, empty);
  assert.equal(blank.status, 400);
  assert.match((await blank.json()).error, /empty/i);
});
