/**
 * AC5: the app renders in a real browser. Every route heads its own page with no console error and
 * no uncaught exception, the home page lists every card, the storyboard runs two shots in list
 * order and removes one, the cinematic prompt helper fills the prompt, a preset fills the Soul
 * prompt, Edit measures a clip and submits, Academy lists its lessons, and a cast character
 * survives a reload. One screenshot per route is kept as evidence.
 *
 * The browser is one already on disk (CHROME_BIN, Playwright's cache or the system Chrome), driven
 * over the DevTools protocol by tests/lib/browser.mjs. It is not part of `npm test`; run
 * `npm run test:browser` on a machine with a browser, or point CHROME_BIN at one.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { openBrowser } from "./lib/browser.mjs";
import { RECORD_STATUSES, pageTools } from "./lib/page-tools.mjs";
import { HOME_CARDS, ROUTES } from "./lib/routes.mjs";
import { startServer } from "./lib/server.mjs";
import { uploadNoiseImage } from "./lib/upload.mjs";

const SCREENSHOT_DIR = "tests/screenshots";
const EDIT_CLIP = readFileSync("tests/fixtures/edit-source.webm").toString("base64");
const EDIT_CLIP_SHORT = readFileSync("tests/fixtures/edit-source-2.6s.webm").toString("base64");

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

const capture = (sessionId, name) => tools.capture(sessionId, name);
const setField = (sessionId, labelText, value) => tools.setField(sessionId, labelText, value);
const setShotPrompt = (sessionId, index, value) => tools.setShotPrompt(sessionId, index, value);
const shotStatus = (index) => tools.shotStatus(index);
const shotState = (index) => tools.shotState(index);
const clickButton = (sessionId, text) => tools.clickButton(sessionId, text);
const waitFor = (sessionId, expression, message, timeoutMs) =>
  tools.waitFor(sessionId, expression, message, timeoutMs);
const watchGenerate = (sessionId, key) => tools.watchGenerate(sessionId, key);
const generateButton = (sessionId) => tools.generateButton(sessionId);

after(async () => {
  await browser?.close();
  studio?.stop();
});

test("the home page renders with no console error", async () => {
  const { sessionId, consoleErrors } = await browser.openPage(BASE);

  const page = JSON.parse(
    await browser.evaluate(
      sessionId,
      `JSON.stringify({
        title: document.title,
        heading: document.querySelector("h1")?.innerText ?? "",
        cards: [...document.querySelectorAll("main a")].map((link) => link.getAttribute("href")),
        body: document.body.innerText,
      })`,
    ),
  );

  await capture(sessionId, "home");

  assert.equal(page.title, "Kinemi");
  assert.match(page.heading, /screening room for ComfyUI film work/i);
  assert.deepEqual(page.cards, HOME_CARDS);
  assert.match(page.body, /\d+ open models from \d+ vendors/);
  assert.match(page.body, /\d+ camera moves/);
  assert.deepEqual(consoleErrors, []);
});

test("every route heads its own page with no console error", async (t) => {
  for (const route of ROUTES) {
    const { sessionId, consoleErrors } = await browser.openPage(`${BASE}${route.path}`);
    const heading = await browser.evaluate(sessionId, `document.querySelector("h1")?.innerText ?? ""`);
    await capture(sessionId, route.shot);

    assert.match(heading, route.heading, `${route.path} should head its own page`);
    assert.deepEqual(consoleErrors, [], `${route.path} should log no console error`);
    t.diagnostic(
      `route ${route.path.padEnd(11)} heading ok  shot ${SCREENSHOT_DIR}/${route.shot}.png  console errors: ${consoleErrors.length}`,
    );
  }
});

test("the storyboard runs two shots in order and removes one", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/storyboard`);

  const shotCount = `[...document.querySelectorAll("button")].filter((node) => node.textContent.trim() === "Remove").length`;
  assert.equal(await browser.evaluate(sessionId, shotCount), 1, "a new board starts with one shot");

  await clickButton(sessionId, "Add shot");
  await waitFor(sessionId, `${shotCount} === 2`, "Add shot should add a second shot");

  await setShotPrompt(sessionId, 1, "A wide shot of a lighthouse in fog");
  await setShotPrompt(sessionId, 2, "The same lighthouse from the cliff path");
  await waitFor(
    sessionId,
    `document.body.innerText.includes("2 of 2 ready")`,
    "the board estimate should count both ready shots",
  );

  await browser.evaluate(sessionId, RECORD_STATUSES);
  await clickButton(sessionId, "Run all");
  await waitFor(sessionId, `${shotStatus(2)} === "Done"`, "the second queued shot should finish", 60000);

  const log = JSON.parse(await browser.evaluate(sessionId, "JSON.stringify(window.__shotLog)"));
  assert.ok(log.length > 0, "the page should record the shot statuses");

  const secondStarts = log.find((entry) => entry.shots[1]?.status !== "Waiting");
  assert.ok(secondStarts, "the second shot should leave Waiting and run");
  assert.equal(
    secondStarts.shots[0]?.status,
    "Done",
    "the first shot should be Done before the second starts",
  );

  const overlapped = log.filter(
    (entry) => entry.shots[0]?.status === "Rendering" && entry.shots[1]?.status === "Rendering",
  );
  assert.equal(overlapped.length, 0, "two shots should never render at the same time");

  const last = log.at(-1);
  assert.equal(last?.shots[0]?.status, "Done", "the first shot should finish");
  assert.equal(last?.shots[1]?.status, "Done", "the second shot should finish");

  for (const index of [1, 2]) {
    const status = await browser.evaluate(sessionId, shotState(index));
    assert.equal(
      status,
      "succeeded",
      `shot ${index}'s job should reach status succeeded, not just show the Done label`,
    );
    t.diagnostic(`shot ${index} data-status=${status} while its chip reads Done`);
  }

  await capture(sessionId, "storyboard-run");

  await clickButton(sessionId, "Remove");
  await waitFor(sessionId, `${shotCount} === 1`, "Remove should take one shot off the board");
  await waitFor(
    sessionId,
    `document.body.innerText.includes("1 of 1 ready")`,
    "the shot that stayed should still be ready",
  );

  assert.deepEqual(consoleErrors, []);
});

test("the cinematic prompt helper fills the prompt", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/cinematic`);

  await setField(sessionId, "Your idea", "A lone lighthouse in heavy fog");
  await clickButton(sessionId, "Fill prompt");
  await waitFor(
    sessionId,
    `(() => {
      const label = [...document.querySelectorAll("label")].find((node) => node.textContent.trim() === "Prompt");
      return Boolean(label) && (document.getElementById(label.htmlFor)?.value ?? "").includes("lone lighthouse");
    })()`,
    "Fill prompt should write the prompt field",
  );

  const prompt = await browser.evaluate(
    sessionId,
    `(() => {
      const label = [...document.querySelectorAll("label")].find((node) => node.textContent.trim() === "Prompt");
      return document.getElementById(label.htmlFor).value;
    })()`,
  );
  assert.match(prompt, /\.$/, "the composed prompt should end with a period");
  assert.deepEqual(consoleErrors, []);
  t.diagnostic(`prompt helper filled from one sentence: ${JSON.stringify(prompt)}`);
});

test("a Soul preset fills the prompt and renders a still", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/soul`);

  const readPalette = () =>
    browser.evaluate(
      sessionId,
      `[...document.querySelectorAll('button[aria-label^="Copy #"]')].map((node) => node.getAttribute("aria-label"))`,
    );

  const firstPalette = await readPalette();
  assert.equal(firstPalette.length, 5, "the palette should hold five swatches");
  for (const label of firstPalette) {
    assert.match(label, /^Copy #[0-9a-f]{6}$/i, "every swatch should copy a six-digit HEX code");
  }

  // The sentence seeds the palette: a second sentence has to build a different five HEX codes.
  const sentence = "a neon koi in a flooded arcade";
  await setField(sessionId, "Sentence", sentence);
  const swatches = { labels: await readPalette() };
  assert.equal(swatches.labels.length, 5, "the palette should keep five swatches");
  for (const label of swatches.labels) {
    assert.match(label, /^Copy #[0-9a-f]{6}$/i, "a rebuilt swatch should still copy a six-digit HEX code");
  }
  assert.notDeepEqual(swatches.labels, firstPalette, "a new sentence should rebuild the palette");

  const generate = () => generateButton(sessionId);

  assert.deepEqual(await generate(), { disabled: true, title: "Pick a Soul 2.0 preset" });

  await browser.evaluate(
    sessionId,
    `(() => {
      const preset = [...document.querySelectorAll("button")].find((node) =>
        node.textContent.trim().startsWith("Wet asphalt neon"),
      );
      if (!preset) throw new Error("no Wet asphalt neon preset");
      preset.click();
      return true;
    })()`,
  );

  const prompt = await browser.evaluate(
    sessionId,
    `(() => {
      const label = [...document.querySelectorAll("label")].find((node) => node.textContent.trim() === "Prompt");
      return document.getElementById(label.htmlFor).value;
    })()`,
  );
  assert.match(prompt, /palette \{palette\}/, "the preset should write its template into the prompt");
  assert.equal((await generate()).disabled, false, "a preset plus its prompt should enable Generate");

  await setField(sessionId, "Sentence", "");
  assert.deepEqual(
    await generate(),
    { disabled: true, title: "Add a sentence to build a palette" },
    "an empty sentence should block the run",
  );
  await setField(sessionId, "Sentence", sentence);
  assert.equal((await generate()).disabled, false, "restoring the sentence should re-enable Generate");

  await watchGenerate(sessionId, "__soulRequest");

  await clickButton(sessionId, "Generate");
  await waitFor(
    sessionId,
    `Boolean(document.querySelector('img[alt="Generated result"]'))`,
    "the demo run should show a still",
    60000,
  );

  const request = await browser.evaluate(sessionId, "window.__soulRequest");
  assert.equal(request.mode, "soul");
  assert.equal(request.durationS, 1);
  assert.equal(request.params.preset, "wet-asphalt-neon");
  assert.doesNotMatch(request.prompt, /\{palette\}/, "the token should be replaced before submit");
  for (const label of swatches.labels) {
    const hex = label.slice("Copy ".length);
    assert.ok(request.prompt.includes(hex), `the sent prompt should carry ${hex}`);
  }

  await capture(sessionId, "soul-result");
  assert.deepEqual(consoleErrors, []);
  t.diagnostic(`Soul preset sent ${request.prompt.length} characters for preset ${request.params.preset}`);
});

test("Edit measures a clip and sends the requested length", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/edit`);

  const state = () =>
    browser.evaluate(
      sessionId,
      `(() => {
        const read = (label) => {
          const row = [...document.querySelectorAll("p")].find(
            (node) => node.firstElementChild?.textContent.trim() === label,
          );
          return row?.lastElementChild?.textContent.trim() ?? "";
        };
        const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Generate");
        return { length: read("Source length"), effective: read("Effective duration"), disabled: button?.disabled ?? null, title: button?.title ?? "" };
      })()`,
    );

  const empty = await state();
  assert.equal(empty.disabled, true, "Generate should wait for a clip");
  assert.equal(empty.title, "Add a source clip first");

  await browser.evaluate(
    sessionId,
    `(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(EDIT_CLIP)}), (char) => char.charCodeAt(0));
      const file = new File([bytes], "edit-source.webm", { type: "video/webm" });
      const input = document.querySelector('input[type="file"]');
      if (!input) throw new Error("no source clip input");
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return input.files.length;
    })()`,
  );

  await waitFor(
    sessionId,
    `(() => {
      const row = [...document.querySelectorAll("p")].find(
        (node) => node.firstElementChild?.textContent.trim() === "Source length",
      );
      return Boolean(row) && /^\\d+(\\.\\d+)?s$/.test(row.lastElementChild.textContent.trim());
    })()`,
    "the clip length should be measured",
    20000,
  );

  const measured = await state();
  assert.equal(measured.length, "3s", "the fixture is a three second clip");
  assert.equal(measured.effective, "3s", "the requested length should seed from the clip");
  assert.equal(measured.disabled, true, "Generate should wait for a prompt");
  assert.equal(measured.title, "Describe the edit first");

  await setField(sessionId, "Prompt", "make the sky green");
  await watchGenerate(sessionId, "__editRequest");

  await clickButton(sessionId, "Generate");
  await waitFor(
    sessionId,
    `Boolean(document.querySelector('img[alt="Generated result"]'))`,
    "the demo run should show a result",
    60000,
  );

  const request = await browser.evaluate(sessionId, "window.__editRequest");
  assert.equal(request.mode, "edit");
  assert.equal(request.durationS, 3, "the run should carry the clip's length");
  assert.equal(request.params.strength, 5);
  assert.ok(Math.abs(request.params.sourceDurationS - 3) < 0.1, "the source length should ride along");
  assert.match(request.prompt, /^edit the clip: make the sky green\./);

  await capture(sessionId, "edit-result");
  assert.deepEqual(consoleErrors, []);
  t.diagnostic(`Edit sent mode ${request.mode} at ${request.durationS}s from a ${request.params.sourceDurationS}s clip`);

  await browser.evaluate(
    sessionId,
    `(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(EDIT_CLIP_SHORT)}), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "edit-source-2.6s.webm", { type: "video/webm" }));
      const input = document.querySelector('input[type="file"]');
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
  await waitFor(sessionId, `/Source length\\s*2\\.6s/.test(document.body.innerText)`, "the short clip should be measured", 20000);
  const short = await state();
  assert.equal(short.length, "2.6s", "the second fixture is a 2.625 second clip");
  assert.equal(short.effective, "2s", "a 2.625s clip must not seed a 3s request");
});

test("the Academy lists its lessons as anchored sections", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/academy`);

  const lessons = await browser.evaluate(
    sessionId,
    `(() => {
      const headings = [...document.querySelectorAll("main h2")].map((node) => ({
        id: node.id,
        title: node.textContent.trim(),
      }));
      const links = [...document.querySelectorAll('nav[aria-label="Lesson contents"] a')].map((node) =>
        node.getAttribute("href"),
      );
      return { headings, links };
    })()`,
  );

  assert.ok(lessons.headings.length >= 6, "the Academy should carry at least six lessons");
  assert.equal(
    new Set(lessons.headings.map((heading) => heading.id)).size,
    lessons.headings.length,
    "every lesson needs its own id",
  );
  for (const heading of lessons.headings) {
    assert.ok(heading.title.length > 0, "every lesson needs a heading");
    assert.ok(lessons.links.includes(`#${heading.id}`), `the contents should link to ${heading.id}`);
  }

  assert.deepEqual(consoleErrors, []);
  t.diagnostic(`Academy lists ${lessons.headings.length} lessons: ${lessons.headings.map((heading) => heading.title).join(" | ")}`);
});

test("a cast character survives a reload and copies its tag", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/cast`);

  const upload = await uploadNoiseImage(browser, sessionId);
  assert.ok(upload.sourceBytes < 2 * 1024 * 1024, "the fixture should sit under the 2 MB reference limit");

  await waitFor(
    sessionId,
    `document.querySelectorAll('img[alt="mara.jpg"]').length === 1`,
    "the reference thumbnail should appear",
  );

  await setField(sessionId, "Name", "Mara");
  await clickButton(sessionId, "Save character");
  await waitFor(sessionId, `document.body.innerText.includes("Saved.")`, "the character should save");

  const stored = await browser.evaluate(
    sessionId,
    `(async () => {
      const [character] = JSON.parse(localStorage.getItem("kinemi.cast.v1"));
      const ref = character.refs[0];
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("the stored reference should decode"));
        element.src = ref.dataUrl;
      });
      return {
        name: ref.name,
        prefix: ref.dataUrl.slice(0, 24),
        storedChars: ref.dataUrl.length,
        sourceChars: window.__sourceChars,
        width: image.width,
        height: image.height,
      };
    })()`,
  );
  assert.equal(stored.name, "mara.jpg");
  assert.ok(
    stored.prefix.startsWith("data:image/jpeg;base64,"),
    `the reference should be stored as JPEG, got ${stored.prefix}`,
  );
  assert.ok(
    stored.storedChars < stored.sourceChars * 0.6,
    `the stored reference should be under 60% of the upload (${stored.storedChars} vs ${stored.sourceChars} chars)`,
  );
  assert.equal(Math.max(stored.width, stored.height), 512, "the stored reference should be capped at 512 px");

  assert.deepEqual(consoleErrors, []);

  const again = await browser.openPage(`${BASE}/cast`);
  await waitFor(
    again.sessionId,
    `document.body.innerText.includes("Mara")`,
    "the saved cast should survive a reload",
    15000,
  );

  await browser.evaluate(
    again.sessionId,
    `(() => {
      const card = [...document.querySelectorAll("button")].find((node) =>
        node.textContent.trim().startsWith("Mara"),
      );
      if (!card) throw new Error("no saved Mara card");
      card.click();
      return true;
    })()`,
  );
  await clickButton(again.sessionId, "joy");
  await browser.evaluate(
    again.sessionId,
    `(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text) => { window.__copiedTag = text; } },
      });
      return true;
    })()`,
  );
  await clickButton(again.sessionId, "Copy tag");
  await waitFor(
    again.sessionId,
    `window.__copiedTag === "@Mara joy"`,
    "the copy button should write the exact name and emotion tag",
  );

  await capture(again.sessionId, "cast-saved");
  assert.deepEqual(again.consoleErrors, []);
  t.diagnostic(`cast tag copied as ${JSON.stringify(await browser.evaluate(again.sessionId, "window.__copiedTag"))}`);
});
