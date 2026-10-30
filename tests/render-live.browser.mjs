/**
 * Live render progress in a real Chrome: the studio shows what the server's Job.live says (the queued
 * message, elapsed time ticking between polls, step x/y, remaining time only when the server gives
 * one, GPU time and Comfy credits once done), and with no live report only the percentage. The
 * server's job answers are stubbed in the page. Needs `npm run build` first.
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

const HUD = "document.querySelector('.call-render-hud span')?.textContent ?? ''";
const BAR = "Number(document.querySelector('.call-render [role=progressbar]')?.getAttribute('aria-valuenow') ?? -1)";
const SECOND_MS = 1000;

/**
 * Answer POST /api/generate and GET /api/jobs/live-* in the page; every other call reaches the server.
 * The test sets window.__job to what the job route answers, and window.__hold holds that answer open.
 */
const STUB_JOBS = `(() => {
  const real = window.fetch;
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  window.__posts = 0;
  window.__hold = false;
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/generate') && init?.method === 'POST') return json({ jobId: 'live-' + ++window.__posts });
    if (!url.includes('/api/jobs/live-')) return real(input, init);
    while (window.__hold) await new Promise((resolve) => setTimeout(resolve, 100));
    return json(window.__job);
  };
  return true;
})()`;

/** The server job the stub answers, with `live` left out when it is undefined. */
const serverJob = (status, live, extra = {}) => `window.__job = ${JSON.stringify({ id: "live-1", status, progress: 0, demo: false, ...(live ? { live } : {}), ...extra })}`;

/** Open the chat with the job stub in, set up a shot with the built-in assistant and Approve it. */
async function approvedShot(firstJob) {
  await seedStorage(open, { "kinemi.device.v1": JSON.stringify({}) });
  const page = await open("/app/");
  await until(page.run, "document.querySelector('.composer:not(.is-docked) textarea')", "the welcome composer", 10000);
  await page.run(STUB_JOBS);
  await page.run(firstJob);
  await say(page.run, "A slow dolly-in on a lighthouse");
  await until(page.run, "!!document.querySelector('.call.is-ready')", "the shot the assistant set up", 10000);
  await say(page.run, "Render it");
  await until(page.run, "document.querySelector('.call-approve')", "the approval bar", 10000);
  await page.run("[...document.querySelectorAll('.call-approve button')].find((b) => b.textContent.includes('Approve')).click()");
  await until(page.run, "!!document.querySelector('.call-render')", "the render in the chat card", 10000);
  return page;
}

const secondsElapsed = (text) => Number(/(\d+) s elapsed/.exec(text)?.[1] ?? NaN);

test("a live render shows the queued message, real elapsed and step, remaining only when given, then GPU time and credits", async () => {
  const queuedAt = Date.now() - 5 * SECOND_MS;
  const queued = { phase: "queued", message: "Waiting for a machine…", queuedAt, fraction: 0, gpuMs: 0, source: "cloud" };
  const { run } = await approvedShot(serverJob("queued", queued));

  const waiting = await until(run, `(() => { const t = ${HUD}; return t.includes('Waiting for a machine') && t; })()`, "the queued message", 10000);
  // a poll answered, so every take was submitted by now
  assert.equal(await run("window.__posts"), 1, "the shot is one take");
  assert.doesNotMatch(waiting, /Rendering/, "a job the server still queues isn't called rendering");
  assert.ok(secondsElapsed(waiting) >= 5, `elapsed counts from queuedAt: ${waiting}`);

  // hold the job poll open: only the studio's own clock can move elapsed now
  await run("window.__hold = true");
  await sleep(SECOND_MS);
  const before = secondsElapsed(await run(HUD));
  await sleep(2.5 * SECOND_MS);
  const later = secondsElapsed(await run(HUD));
  assert.ok(later >= before + 2, `elapsed ticks every second between polls: ${before} s, then ${later} s`);

  const startedAt = Date.now() - 3 * SECOND_MS;
  const running = { ...queued, phase: "running", message: undefined, startedAt, step: 5, steps: 20, node: "KSampler", fraction: 0.25 };
  await run(serverJob("running", running));
  await run("window.__hold = false");
  await until(run, `${BAR} === 25`, "the bar at the server's fraction", 10000);
  const firstLine = await run(HUD);
  assert.match(firstLine, /^Rendering · \d+ s elapsed · step 5\/20$/, `no remaining time until the server gives one: ${firstLine}`);
  assert.ok(secondsElapsed(firstLine) >= 3 && secondsElapsed(firstLine) < 5, `elapsed counts from startedAt: ${firstLine}`);

  await run(serverJob("running", { ...running, step: 12, fraction: 0.6, remainingMs: 30 * SECOND_MS }));
  await until(run, `${BAR} === 60`, "the bar rising with the fraction", 10000);
  assert.match(await run(HUD), /· 30 s left · step 12\/20$/, "the server's remaining time");

  const done = { ...running, phase: "done", step: 20, fraction: 1, endedAt: startedAt + 42 * SECOND_MS, remainingMs: 0, gpuMs: 42 * SECOND_MS, credits: 3.5 };
  await run(serverJob("succeeded", done, { progress: 100, result: { url: "/favicon.svg", kind: "image", width: 64, height: 64 } }));
  await until(run, "!!document.querySelector('.call.is-done')", "the landed render", 10000);
  await run("document.querySelector('.queue-btn').click()");
  const row = await until(run, "document.querySelector('.queue-item.is-done .queue-info .mono')?.textContent", "the done row in the queue", 5000);
  assert.match(row, /done · GPU 42 s · 3\.5 credits$/, `real GPU time and Comfy credits: ${row}`);
});

test("with no live report only the percentage shows: no elapsed, remaining or credits", async () => {
  const { run } = await approvedShot(serverJob("running", undefined, { progress: 40 }));
  await until(run, `${BAR} === 40`, "the bar at the server's progress", 10000);
  assert.equal(await run(HUD), "Rendering", "nothing beside the percentage");
  await run("document.querySelector('.queue-btn').click()");
  const row = await until(run, "document.querySelector('.queue-item.is-rendering .queue-info .mono')?.textContent", "the queue row", 5000);
  assert.match(row, /· 40%$/, `the queue row shows the percentage only: ${row}`);

  await run(serverJob("succeeded", undefined, { progress: 100, result: { url: "/favicon.svg", kind: "image", width: 64, height: 64 } }));
  const done = await until(run, "document.querySelector('.queue-item.is-done .queue-info .mono')?.textContent", "the done row", 10000);
  assert.match(done, /· done$/, `no invented credits once done: ${done}`);
});

/** Type into the composer and send it. */
async function say(run, text) {
  await run(typeInComposer(text));
  await until(run, "document.querySelector('.composer-row textarea').value.length > 0", "the typed draft", 5000);
  await sleep(100);
  await run("document.querySelector('.composer-row textarea').closest('form').requestSubmit()");
}

test("no page logged a console error", () => {
  assert.deepEqual(errors, []);
});
