/**
 * T-0052: a clean deployment runs Re-shoot end to end. The suite starts a fresh production server,
 * loads a still through the page's real file input, asks for the Three-quarter angle, submits and
 * waits for the demo job to succeed. It then proves the stored job reattaches on a second load
 * without a Generate click, that Reset clears it, and that a stale stored id falls back to an
 * empty stage. Screenshots: tests/screenshots/reshoot-e2e.png and reshoot-reattach.png.
 *
 * Like the other browser suite it needs a Chromium on disk (CHROME_BIN, Playwright's cache or the
 * system browser); run it after `npm run build` with `node --test tests/reshoot.e2e.mjs`.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openBrowser } from "./lib/browser.mjs";
import { pageTools } from "./lib/page-tools.mjs";
import { startServer } from "./lib/server.mjs";

const SCREENSHOT_DIR = "tests/screenshots";
const SHOT_NAME = "reshoot-e2e";
const REATTACH_SHOT_NAME = "reshoot-reattach";

/** A 1x1 PNG: the smallest real still the page can preview and send. */
const STILL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** The Three-quarter chip's settings, which the request must carry. */
const THREE_QUARTER = { preset: "three-quarter", orbit: 30, tilt: 5, zoom: 1.15, roll: 0 };

/** The job id useJob keeps for this flow, so a second load can reattach to it. */
const STORAGE_ENTRY = "kinemi.job.reshoot";

/** An id no demo job ever had: the job route answers 404 for it. */
const STALE_JOB_ID = "stale-job-does-not-exist";

/** The Stage's empty title, shown only when no job, run or error is on it. */
const EMPTY_TITLE = "Drop a still to re-shoot";

/** The Stage panel's subtitle says "Result" only when the job reached status succeeded. */
const JOB_SUCCEEDED = `(() => {
  const panel = [...document.querySelectorAll("section")].find(
    (node) => node.querySelector("h2")?.textContent.trim() === "Stage",
  );
  return panel?.querySelector("header p")?.textContent.trim() === "Result";
})()`;

const RESULT_LOADED = `(() => {
  const image = document.querySelector('img[alt="Generated result"]');
  return Boolean(image) && image.complete && image.naturalWidth > 0;
})()`;

const GENERATE_ENABLED = `(() => {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Generate");
  return button !== undefined && !button.disabled;
})()`;

/** The raw value under the flow's storage key, read on any page of the same origin. */
const STORED_JOB_ID = `localStorage.getItem(${JSON.stringify(STORAGE_ENTRY)})`;

/** The Stage shows its empty title only when there is no job, no run and no error. */
const EMPTY_STAGE = `(() => {
  const panel = [...document.querySelectorAll("section")].find(
    (node) => node.querySelector("h2")?.textContent.trim() === "Stage",
  );
  return panel?.textContent.includes(${JSON.stringify(EMPTY_TITLE)}) === true;
})()`;

/** The Stage's error slot: the alert role or the flow's .error paragraph (hashed class name). */
const STAGE_ERROR = `(() => {
  const panel = [...document.querySelectorAll("section")].find(
    (node) => node.querySelector("h2")?.textContent.trim() === "Stage",
  );
  if (!panel) throw new Error("no Stage panel");
  const slot = panel.querySelector('[role="alert"], [class*="error"]');
  return slot ? slot.textContent.trim() : null;
})()`;

let BASE = "";
let studio;
let browser;
let tools;

before(async () => {
  studio = await startServer();
  BASE = studio.base;
  browser = await openBrowser();
  tools = pageTools(browser, SCREENSHOT_DIR);
});

after(async () => {
  await browser?.close();
  studio?.stop();
});

test("Re-shoot loads a still and runs it to a result", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/reshoot`);

  const heading = await browser.evaluate(sessionId, `document.querySelector("h1")?.innerText ?? ""`);
  assert.match(heading, /^Re-shoot$/, "the /reshoot page should head itself");

  const beforeUpload = await tools.generateButton(sessionId);
  assert.equal(beforeUpload?.disabled, true, "Generate should wait for a still");

  await browser.evaluate(
    sessionId,
    `(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(STILL_PNG)}), (char) => char.charCodeAt(0));
      const file = new File([bytes], "still.png", { type: "image/png" });
      const input = document.querySelector('input[type=file][aria-label="Drop a still"]');
      if (!input) throw new Error("no still input");
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return input.files.length;
    })()`,
  );

  await tools.waitFor(sessionId, GENERATE_ENABLED, "Generate should turn enabled once the still is in");
  const afterUpload = await tools.generateButton(sessionId);
  assert.equal(afterUpload?.disabled, false, "the still should enable Generate");

  await tools.clickButton(sessionId, "Three-quarter");
  await tools.watchGenerate(sessionId, "__reshootRequest");
  await tools.clickButton(sessionId, "Generate");

  await tools.waitFor(
    sessionId,
    `window.__reshootRequest !== undefined`,
    "the run should post a request body",
  );
  const request = await browser.evaluate(sessionId, "window.__reshootRequest");
  assert.equal(request.mode, "reshoot");
  assert.equal(request.params.preset, THREE_QUARTER.preset);
  assert.equal(request.params.orbit, THREE_QUARTER.orbit);
  assert.equal(request.params.tilt, THREE_QUARTER.tilt);
  assert.equal(request.params.zoom, THREE_QUARTER.zoom);
  assert.equal(request.params.roll, THREE_QUARTER.roll);
  assert.equal(request.durationS, 1);

  await tools.waitFor(sessionId, JOB_SUCCEEDED, "the demo job should reach status succeeded", 60000);
  await tools.waitFor(sessionId, RESULT_LOADED, "the result image should finish loading", 20000);

  const result = await browser.evaluate(
    sessionId,
    `(() => {
      const image = document.querySelector('img[alt="Generated result"]');
      return image ? { complete: image.complete, naturalWidth: image.naturalWidth } : undefined;
    })()`,
  );
  assert.ok(result, "the succeeded job should show a generated result");
  assert.equal(result.complete, true, "the result image should be complete");
  assert.ok(result.naturalWidth > 0, "the result image should have a non-zero natural width");

  await tools.capture(sessionId, SHOT_NAME);
  assert.deepEqual(consoleErrors, []);

  t.diagnostic(
    `Re-shoot sent ${request.params.preset} and showed a ${result.naturalWidth}px-wide result`,
  );
});

test("a second load reattaches to the stored Re-shoot job", async (t) => {
  // A same-origin tab that mounts no flow reads the key without touching it: this is the value
  // the second /reshoot load must inherit.
  const probe = await browser.openPage(BASE);
  const storedBefore = await browser.evaluate(probe.sessionId, STORED_JOB_ID);
  assert.ok(storedBefore, "the first run should have stored a job id");

  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/reshoot`);
  const storedAfterLoad = await browser.evaluate(sessionId, STORED_JOB_ID);
  assert.equal(
    storedAfterLoad,
    storedBefore,
    "the second load should keep the stored job id; a newly posted job would have replaced it",
  );

  const generate = await tools.generateButton(sessionId);
  assert.equal(generate?.disabled, true, "a fresh page has no still, so Generate could not start a run");

  await tools.waitFor(
    sessionId,
    JOB_SUCCEEDED,
    "the stored job should attach and reach status succeeded without a Generate click",
    60000,
  );
  await tools.waitFor(sessionId, RESULT_LOADED, "the attached result image should finish loading", 20000);
  await tools.capture(sessionId, REATTACH_SHOT_NAME);

  const storedAfterResult = await browser.evaluate(sessionId, STORED_JOB_ID);
  assert.equal(
    storedAfterResult,
    storedBefore,
    "the id should not change once the attached result is on screen",
  );
  assert.deepEqual(consoleErrors, []);

  t.diagnostic(
    `A second /reshoot load restored job ${storedBefore} with no Generate click; the id was unchanged before and after the result, and a new POST would have replaced it`,
  );
});

test("Reset clears the stored job and the stage", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/reshoot`);
  await tools.waitFor(sessionId, JOB_SUCCEEDED, "the stored job should reattach before Reset", 60000);
  assert.ok(
    await browser.evaluate(sessionId, STORED_JOB_ID),
    "the reattached page should still hold the job id",
  );

  await tools.clickButton(sessionId, "Reset");
  await tools.waitFor(sessionId, EMPTY_STAGE, "Reset should put the Stage back to its empty title");
  const storedAfterReset = await browser.evaluate(sessionId, STORED_JOB_ID);
  assert.equal(storedAfterReset, null, "Reset should remove the stored job id");
  assert.deepEqual(consoleErrors, []);

  const again = await browser.openPage(`${BASE}/reshoot`);
  await tools.waitFor(again.sessionId, EMPTY_STAGE, "a load after Reset should still show the empty stage");
  assert.equal(
    await browser.evaluate(again.sessionId, STORED_JOB_ID),
    null,
    "the reset should stay cleared on the next load",
  );
  const generate = await tools.generateButton(again.sessionId);
  assert.equal(generate?.disabled, true, "a fresh page has no still, so Generate should stay disabled");
  assert.deepEqual(again.consoleErrors, []);

  t.diagnostic(`Reset removed ${STORAGE_ENTRY} and a fresh load stayed empty with Generate disabled`);
});

test("a stale stored job id falls back to an empty stage", async (t) => {
  const probe = await browser.openPage(BASE);
  const seeded = await browser.evaluate(
    probe.sessionId,
    `(() => {
      localStorage.setItem(${JSON.stringify(STORAGE_ENTRY)}, ${JSON.stringify(STALE_JOB_ID)});
      return localStorage.getItem(${JSON.stringify(STORAGE_ENTRY)});
    })()`,
  );
  assert.equal(seeded, STALE_JOB_ID, "the stale id should be seeded before the load");

  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/reshoot`);
  await tools.waitFor(
    sessionId,
    `localStorage.getItem(${JSON.stringify(STORAGE_ENTRY)}) === null`,
    "the 404 for the restored id should clear the stale key",
  );
  await tools.waitFor(sessionId, EMPTY_STAGE, "the stale id should leave the empty stage");

  const error = await browser.evaluate(sessionId, STAGE_ERROR);
  assert.equal(error, null, "a job the server does not know is cleared without showing an error");
  const generate = await tools.generateButton(sessionId);
  assert.equal(generate?.disabled, true, "the empty stage has no still, so Generate should stay disabled");
  assert.deepEqual(consoleErrors, []);

  t.diagnostic(
    `Seeded ${STORAGE_ENTRY}=${STALE_JOB_ID}; the 404 cleared the key, left the empty stage with Generate disabled and rendered no error`,
  );
});
