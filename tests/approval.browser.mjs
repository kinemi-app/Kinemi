/**
 * The render approval card in a real Chrome: a shot the assistant sets up waits for Approve, Not now
 * is final, and YOLO skips the card. Needs `npm run build` first.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";

import { openBrowser } from "./lib/browser.mjs";
import { pageOpener, seedStorage, sleep, typeInComposer, until } from "./lib/page.mjs";
import { startServer } from "./lib/server.mjs";

let app;
let browser;
const errors = [];
const open = pageOpener(() => ({ browser, app }), errors);

before(async () => {
  assert.ok(existsSync("web/dist/index.html"), "web/dist is missing: run `npm run build` first");
  app = await startServer();
  browser = await openBrowser();
});

after(async () => {
  await browser?.close();
  app?.stop();
});

/** No device settings: the default studio, with the approval card on. */
const plainDevice = () => seedStorage(open, { "kinemi.device.v1": JSON.stringify({}) });

const LAST_REPLY = "[...document.querySelectorAll('.msg-bot .msg-text')].at(-1)?.textContent ?? ''";

/** Set up a shot with the built-in assistant, say "Render it" and wait for the approval bar. */
async function proposeShot(run) {
  await startChat(run, "A slow dolly-in on a lighthouse");
  await until(run, "!!document.querySelector('.call.is-ready')", "the shot the assistant set up", 10000);
  await say(run, "Render it");
  await until(run, "document.querySelector('.call-approve')", "the approval bar", 10000);
}

test("a shot Kinemi sets up waits for Approve, and the reply never says it is rolling", async () => {
  await plainDevice();
  const { run } = await open("/app/");
  await proposeShot(run);
  assert.match(await run("document.querySelector('.call-approve-text').textContent"), /Nothing has run yet/);
  assert.ok(await run("!!document.querySelector('.call.is-ready')"), "the card is set up but not started");
  const reply = await until(run, `(() => { const t = ${LAST_REPLY}; return /Approve/.test(t) && t; })()`, "the reply pointing at Approve", 10000);
  assert.doesNotMatch(reply, /Rolling/, "nothing rolls while the card waits");
});

test("Not now leaves the shot unrendered, and asking again never puts the card back up", async () => {
  await plainDevice();
  const { run } = await open("/app/");
  await proposeShot(run);
  await run("[...document.querySelectorAll('.call-approve button')].find((b) => b.textContent.includes('Not now')).click()");
  await until(run, "!document.querySelector('.call-approve')", "the bar to go after Not now", 5000);
  assert.equal(await run("document.querySelector('.call').className"), "call is-ready", "nothing started");
  assert.ok(await run("[...document.querySelectorAll('.call-foot button')].some((b) => b.textContent.includes('Render'))"), "the owner can still render it");

  const replies = await run("document.querySelectorAll('.msg-bot').length");
  await say(run, "Render it");
  await until(run, `document.querySelectorAll('.msg-bot').length > ${replies}`, "the answer to the second Render it", 10000);
  const reply = await until(run, `(() => { const t = ${LAST_REPLY}; return /not now/i.test(t) && t; })()`, "the reply that respects Not now", 10000);
  assert.doesNotMatch(reply, /Rolling/);
  await sleep(500);
  assert.equal(await run("!!document.querySelector('.call-approve')"), false, "the declined card is not proposed again");
  assert.equal(await run("document.querySelector('.call').className"), "call is-ready", "and nothing started");
});

test("Approve starts the render the assistant set up", async () => {
  await plainDevice();
  const { run } = await open("/app/");
  await proposeShot(run);
  assert.equal(await run("!!document.querySelector('.call.is-queued, .call.is-rendering, .call.is-done')"), false, "nothing runs before the click");
  await run("[...document.querySelectorAll('.call-approve button')].find((b) => b.textContent.includes('Approve')).click()");
  await until(run, "!!document.querySelector('.call.is-queued, .call.is-rendering, .call.is-done')", "the started render", 10000);
  assert.equal(await run("!!document.querySelector('.call-approve')"), false, "the bar goes with the click");
});

test("YOLO in Settings starts what the assistant sets up without a card", async () => {
  await plainDevice();
  const settingsPage = await open("/app/settings/providers/");
  await until(settingsPage.run, "document.querySelector('[role=switch]')", "the chat settings", 10000);
  await settingsPage.run("[...document.querySelectorAll('[role=switch]')].find((b) => b.textContent.includes('Run without asking')).click()");
  await until(settingsPage.run, "JSON.parse(localStorage.getItem('kinemi.device.v1')).yolo === true", "yolo saved for this device", 5000);

  const { run } = await open("/app/");
  await startChat(run, "A slow dolly-in on a lighthouse");
  await until(run, "!!document.querySelector('.call.is-ready')", "the shot the assistant set up", 10000);
  await say(run, "Render it");
  await until(run, "document.querySelectorAll('.msg').length >= 4", "the answer to Render it", 10000);
  assert.equal(await run("!!document.querySelector('.call-approve')"), false, "no card when YOLO is on");
  await until(run, "!!document.querySelector('.call.is-queued, .call.is-rendering, .call.is-done')", "the render started by itself", 10000);
  await run(`localStorage.setItem("kinemi.device.v1", "{}")`);
});

/** Type into the composer and send it. */
async function say(run, text) {
  await run(typeInComposer(text));
  await until(run, "document.querySelector('.composer-row textarea').value.length > 0", "the typed draft", 5000);
  await sleep(100);
  await run("document.querySelector('.composer-row textarea').closest('form').requestSubmit()");
}

/** Send a first message from the welcome screen and wait for the new chat's header. */
async function startChat(run, text) {
  await until(run, "document.querySelector('.composer:not(.is-docked) textarea')", "the welcome composer", 10000);
  await say(run, text);
  await until(run, "document.querySelector('.thread-head h1')", "the chat header", 10000);
}

test("no page logged a console error", () => {
  assert.deepEqual(errors, []);
});
