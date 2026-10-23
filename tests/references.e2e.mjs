/**
 * S2: the shared reference tray reorders by buttons and by dragging. The suite starts a fresh
 * production server, uploads three stills through the tray's hidden file input, walks one
 * reference earlier and later with the move buttons, then drags one card onto another.
 * Screenshot: tests/screenshots/references-e2e.png.
 *
 * Like the other browser suite it needs a Chromium on disk (CHROME_BIN, Playwright's cache or the
 * system browser); run it after `npm run build` with `node --test tests/references.e2e.mjs`.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openBrowser } from "./lib/browser.mjs";
import { pageTools } from "./lib/page-tools.mjs";
import { startServer } from "./lib/server.mjs";

const SCREENSHOT_DIR = "tests/screenshots";
const SHOT_NAME = "references-e2e";

/** A 1x1 PNG: three copies go in through the tray's hidden input. */
const STILL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const NAMES = ["a.png", "b.png", "c.png"];

/** The names of the reference cards, in the order the tray holds them. */
const REFERENCE_ORDER = `(() => {
  const section = [...document.querySelectorAll("section")].find(
    (node) => node.querySelector("h2")?.textContent.trim() === "References",
  );
  const buttons = section ? [...section.querySelectorAll('button[aria-label^="Remove "]')] : [];
  return buttons.map((node) => node.getAttribute("aria-label").replace(/^Remove /, ""));
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

/** The in-page expression that finds a reference card by its file name. */
function card(name) {
  return `[...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === ${JSON.stringify(`Remove ${name}`)})?.closest("div")`;
}

/** The in-page expression that reads whether the button with this accessible name is disabled. */
function buttonState(label) {
  return `(() => {
    const button = [...document.querySelectorAll("button")].find(
      (node) => node.getAttribute("aria-label") === ${JSON.stringify(label)},
    );
    return button ? button.disabled : undefined;
  })()`;
}

async function buttonDisabled(sessionId, label) {
  const disabled = await browser.evaluate(sessionId, buttonState(label));
  assert.notEqual(disabled, undefined, `the tray should have a button named ${label}`);
  return disabled;
}

async function clickLabel(sessionId, label) {
  await browser.evaluate(
    sessionId,
    `(() => {
      const button = [...document.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === ${JSON.stringify(label)},
      );
      if (!button) throw new Error("no button " + ${JSON.stringify(label)});
      if (button.disabled) throw new Error("button is disabled: " + ${JSON.stringify(label)});
      button.click();
      return true;
    })()`,
  );
}

function orderIs(names) {
  return `JSON.stringify(${REFERENCE_ORDER}) === ${JSON.stringify(JSON.stringify(names))}`;
}

async function assertOrder(sessionId, names) {
  const order = await browser.evaluate(sessionId, REFERENCE_ORDER);
  assert.deepEqual(order, names, `the tray should hold ${names.join(", ")}`);
}

/** Drag one card onto another with real DragEvents, the way the browser drives a move. */
async function dragCard(sessionId, fromName, toName) {
  const payload = await browser.evaluate(
    sessionId,
    `(() => {
      const source = ${card(fromName)};
      if (!source) throw new Error("no card for " + ${JSON.stringify(fromName)});
      window.__refDrag = new DataTransfer();
      source.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.__refDrag }),
      );
      // Chrome reports effectAllowed as "none" on a DataTransfer the page constructed, so the
      // payload is what proves the handler ran; the drop below proves it kept the dragged index.
      return window.__refDrag.getData("text/plain");
    })()`,
  );
  assert.match(payload, /^\d+$/, "dragstart should name the dragged index in the transfer");

  const accepted = await browser.evaluate(
    sessionId,
    `(() => {
      const target = ${card(toName)};
      if (!target) throw new Error("no card for " + ${JSON.stringify(toName)});
      window.__refBeforeClass = target.className;
      return !target.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: window.__refDrag }),
      );
    })()`,
  );
  assert.equal(accepted, true, "dragover should call preventDefault");

  const marked = `(() => {
    const card = ${card(toName)};
    return Boolean(card) && card.className !== window.__refBeforeClass;
  })()`;
  await tools.waitFor(sessionId, marked, "dragover should mark the target card");

  await browser.evaluate(
    sessionId,
    `(() => {
      const target = ${card(toName)};
      if (!target) throw new Error("no card for " + ${JSON.stringify(toName)});
      target.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: window.__refDrag }),
      );
      const source = ${card(fromName)};
      if (!source) throw new Error("no card for " + ${JSON.stringify(fromName)});
      source.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: window.__refDrag }),
      );
      return true;
    })()`,
  );

  const clear = `(() => {
    const card = ${card(toName)};
    return Boolean(card) && card.className === window.__refBeforeClass;
  })()`;
  await tools.waitFor(sessionId, clear, "dragend should clear the target mark");
}

test("References reorder by buttons and by drag", async (t) => {
  const { sessionId, consoleErrors } = await browser.openPage(`${BASE}/cinematic`);

  const heading = await browser.evaluate(sessionId, `document.querySelector("h1")?.innerText ?? ""`);
  assert.match(heading, /^Cinematic$/, "the /cinematic page should head itself");

  const uploaded = await browser.evaluate(
    sessionId,
    `(() => {
      const section = [...document.querySelectorAll("section")].find(
        (node) => node.querySelector("h2")?.textContent.trim() === "References",
      );
      const input = section?.querySelector('input[type=file]');
      if (!input) throw new Error("no reference input");
      const bytes = Uint8Array.from(atob(${JSON.stringify(STILL_PNG)}), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      for (const name of ${JSON.stringify(NAMES)}) {
        transfer.items.add(new File([bytes], name, { type: "image/png" }));
      }
      input.files = transfer.files;
      const handed = transfer.files.length;
      // The tray resets the input after reading it, so the input's FileList is empty by the next
      // line: count the handover here, and prove the tray kept them with the order checks below.
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return handed;
    })()`,
  );
  assert.equal(uploaded, NAMES.length, "three stills should be handed to the tray's input");

  await tools.waitFor(
    sessionId,
    `(${REFERENCE_ORDER}).length === ${NAMES.length}`,
    "the tray should list three references",
  );
  await assertOrder(sessionId, NAMES);

  const count = await browser.evaluate(
    sessionId,
    `(() => {
      const section = [...document.querySelectorAll("section")].find(
        (node) => node.querySelector("h2")?.textContent.trim() === "References",
      );
      const labels = section ? [...section.querySelectorAll("span")].map((node) => node.textContent.trim()) : [];
      return labels.find((text) => /^\\d+ \\/ \\d+$/.test(text)) ?? "";
    })()`,
  );
  assert.equal(count, `3 / 50`, "the tray should count three of its fifty references");

  assert.equal(
    await buttonDisabled(sessionId, "Move a.png earlier"),
    true,
    "the first card cannot move earlier",
  );
  assert.equal(
    await buttonDisabled(sessionId, "Move c.png later"),
    true,
    "the last card cannot move later",
  );
  assert.equal(
    await buttonDisabled(sessionId, "Move b.png earlier"),
    false,
    "a middle card can move earlier",
  );
  assert.equal(
    await buttonDisabled(sessionId, "Move b.png later"),
    false,
    "a middle card can move later",
  );

  await clickLabel(sessionId, "Move b.png earlier");
  await tools.waitFor(
    sessionId,
    orderIs(["b.png", "a.png", "c.png"]),
    "Move b.png earlier should put b first",
  );
  await assertOrder(sessionId, ["b.png", "a.png", "c.png"]);
  assert.equal(
    await buttonDisabled(sessionId, "Move b.png earlier"),
    true,
    "the card moved to the front cannot move earlier",
  );

  await clickLabel(sessionId, "Move b.png later");
  await tools.waitFor(
    sessionId,
    orderIs(["a.png", "b.png", "c.png"]),
    "Move b.png later should put b back in the middle",
  );
  await clickLabel(sessionId, "Move b.png later");
  await tools.waitFor(
    sessionId,
    orderIs(["a.png", "c.png", "b.png"]),
    "Move b.png later again should put b last",
  );
  await assertOrder(sessionId, ["a.png", "c.png", "b.png"]);
  assert.equal(
    await buttonDisabled(sessionId, "Move b.png later"),
    true,
    "the card moved to the end cannot move later",
  );
  assert.equal(
    await buttonDisabled(sessionId, "Move a.png earlier"),
    true,
    "the first card still cannot move earlier",
  );

  await dragCard(sessionId, "b.png", "a.png");
  await tools.waitFor(
    sessionId,
    orderIs(["b.png", "a.png", "c.png"]),
    "dragging b onto a should put b first",
  );
  await assertOrder(sessionId, ["b.png", "a.png", "c.png"]);

  await tools.capture(sessionId, SHOT_NAME);
  assert.deepEqual(consoleErrors, []);

  t.diagnostic("References reordered by buttons and by drag, ending b.png, a.png, c.png");
});
