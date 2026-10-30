/**
 * The chat's providers in a real browser: the effort level chosen in Settings, and the request it
 * produces. OpenRouter is answered by a stubbed fetch, so nothing leaves this machine and no key is
 * needed. Needs `npm run build` first.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { TOOLS } from "../web/src/data/tools.ts";
import { openBrowser } from "./lib/browser.mjs";
import { fakeCliEnv } from "./lib/fake-cli.mjs";
import { pageOpener, seedStorage, sleep, typeInComposer, until } from "./lib/page.mjs";
import { startServer } from "./lib/server.mjs";

let app;
let browser;
let folder;
let cloud;
const errors = [];
const open = pageOpener(() => ({ browser, app }), errors);

const CLOUD_KEY = "comfyui-good-key";
/** Comfy Cloud's GET /api/user, answered here: the one key above is good, every other one is refused. */
const fakeCloud = createServer((req, res) => {
  const good = req.url === "/api/user" && req.headers["x-api-key"] === CLOUD_KEY;
  res.writeHead(good ? 200 : 401, { "Content-Type": "application/json" });
  res.end(JSON.stringify(good ? { email: "ada@example.com" } : {}));
});

before(async () => {
  assert.ok(existsSync("web/dist/index.html"), "web/dist is missing: run `npm run build` first");
  // the chat bridge on, with stand-in Claude Code and Codex (tests/lib/fake-cli.mjs)
  folder = await mkdtemp(join(tmpdir(), "kinemi-providers-"));
  await new Promise((resolve) => fakeCloud.listen(0, "127.0.0.1", resolve));
  cloud = `http://127.0.0.1:${fakeCloud.address().port}`;
  app = await startServer({ env: { ...(await fakeCliEnv(folder)), KINEMI_LOCAL_CLI: "", KINEMI_COMFY_CLOUD_URL: cloud } });
  browser = await openBrowser();
});

after(async () => {
  await browser?.close();
  app?.stop();
  fakeCloud.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});

test("a Comfy Cloud key saved with a pasted quote loads without it, and Test checks it through npm start", async () => {
  await seedStorage(open, { "kinemi.secrets.v1": JSON.stringify({ comfyKey: `${CLOUD_KEY}"` }) });
  const { run } = await open("/app/settings/providers/");
  const SAVED = `document.querySelector('code[aria-label^="Comfy Cloud API key, saved"]')`;
  await until(run, `!!${SAVED}`, "the saved Comfy Cloud key", 10000);
  assert.equal(await run(`${SAVED}.getAttribute('aria-label')`), "Comfy Cloud API key, saved, ends in -key");
  assert.doesNotMatch(await run(`${SAVED}.textContent`), /"/, "the stray quote is gone from the masked key");

  await run(`(() => {
    const box = ${SAVED}.closest('.set-key');
    [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Test').click();
    return true;
  })()`);
  await until(run, `document.body.textContent.includes('The key works')`, "Comfy Cloud accepting the key, asked through the server", 15000);
  assert.ok(await run(`document.body.textContent.includes('Comfy Cloud account: ada@example.com')`));
  assert.ok(!(await run(`document.body.textContent.includes('Couldn’t check it from this browser')`)));
});

/** The provider choice and the level, as the studio keeps them in this browser. */
const device = (effort) =>
  JSON.stringify({ assistant: "openrouter", assistantModels: { openrouter: "openrouter/auto" }, assistantEffort: { openrouter: effort } });

const EFFORT_BUTTON = "[...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label').startsWith('Effort:'))";
const LAST_REPLY = "[...document.querySelectorAll('.msg-bot .msg-text')].at(-1)?.textContent ?? ''";

/**
 * The studio's chat on OpenRouter, with the router answered here: each request is kept in
 * window.__asked, and the answers are given in order (the last one repeats). With `holdAt`, that
 * request's answer waits until the page calls window.__release().
 */
async function openRouterChat(deviceJson, answers, { holdAt = 0 } = {}) {
  await seedStorage(open, { "kinemi.device.v1": deviceJson, "kinemi.secrets.v1": JSON.stringify({ openrouterKey: "sk-or-test" }) });
  const page = await open("/app/");
  await until(page.run, "document.querySelector('.composer-row textarea')", "the composer", 10000);
  await page.run(`(() => {
    const answers = ${JSON.stringify(answers)};
    window.__asked = [];
    window.fetch = async (url, init) => {
      if (!String(url).includes('/chat/completions')) throw new Error('a stubbed fetch was asked for ' + url);
      window.__asked.push(JSON.parse(init.body));
      if (window.__asked.length === ${holdAt}) await new Promise((release) => (window.__release = release));
      const content = answers[Math.min(window.__asked.length, answers.length) - 1];
      return new Response(JSON.stringify({ choices: [{ message: { content } }], model: 'test/model' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    return true;
  })()`);
  return page;
}

/** Type a message and send it with Enter. */
async function say(run, text) {
  await run(typeInComposer(text));
  await run(`(() => {
    document.querySelector('.composer-row textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
}

test("the effort picked in Settings is saved with the provider", async () => {
  await seedStorage(open, { "kinemi.device.v1": JSON.stringify({ assistant: "openrouter" }) });
  const { run } = await open("/app/settings/providers/");

  await until(
    run,
    `[...document.querySelectorAll('button[aria-label]')].some((b) => b.getAttribute('aria-label').startsWith('Effort:'))`,
    "the Effort picker",
    10000,
  );
  await run(`(() => {
    const b = [...document.querySelectorAll('button[aria-label]')].find((n) => n.getAttribute('aria-label').startsWith('Effort:'));
    b.click();
    return true;
  })()`);
  await until(run, "!!document.querySelector('[role=menu]')", "the effort menu", 5000);
  await run(`(() => {
    const item = [...document.querySelectorAll('[role=menu] button')].find((b) => b.textContent.trim() === 'High');
    item.click();
    return true;
  })()`);
  await until(
    run,
    `(() => {
      const saved = JSON.parse(localStorage.getItem('kinemi.device.v1') ?? '{}');
      const label = ${EFFORT_BUTTON}?.getAttribute('aria-label') ?? '';
      return saved.assistantEffort?.openrouter === 'high' && /High/.test(label);
    })()`,
    "the High level saved with the provider and shown in the picker",
    5000,
  );

  const saved = JSON.parse(await run(`localStorage.getItem('kinemi.device.v1')`));
  assert.equal(saved.assistantEffort?.openrouter, "high", "the level is kept with the provider");
  assert.match(
    await run(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find((n) => n.getAttribute('aria-label').startsWith('Effort:')); return b.getAttribute('aria-label'); })()`),
    /High/,
    "the picker shows the saved level",
  );
});

test("the picker offers only the levels the provider takes", async () => {
  await seedStorage(open, { "kinemi.device.v1": JSON.stringify({ assistant: "openrouter" }) });
  const { run } = await open("/app/settings/providers/");
  await until(run, `!!${EFFORT_BUTTON}`, "the Effort picker", 10000);
  await run(`(${EFFORT_BUTTON}.click(), true)`);
  await until(run, "!!document.querySelector('[role=menu]')", "the effort menu", 5000);
  const items = await run(`[...document.querySelectorAll('[role=menu] button')].map((b) => b.textContent.trim())`);
  assert.deepEqual(items, ["The OpenRouter default", "Minimal", "Low", "Medium", "High", "Extra high"], "OpenRouter's reasoning.effort has no max");
});

/** The labels in the menu a Settings picker opens; `prefix` is its aria-label's start. */
async function menuItems(run, prefix) {
  const button = `[...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label').startsWith('${prefix}'))`;
  await until(run, `!!${button}`, `the ${prefix} picker`, 10000);
  await run(`(${button}.click(), true)`);
  await until(run, "!!document.querySelector('[role=menu]')", `the ${prefix} menu`, 5000);
  const items = await run(`[...document.querySelectorAll('[role=menu] button')].map((b) => b.textContent.trim())`);
  await run(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  return items;
}

test("Codex offers the models it lists, each with its own levels, max and ultra included", async () => {
  const codex = (model) => JSON.stringify({ assistant: "codex", assistantModels: { codex: model } });
  await seedStorage(open, { "kinemi.device.v1": codex("gpt-5.6-terra") });
  let page = await open("/app/settings/providers/");
  const models = await menuItems(page.run, "Model:");
  assert.ok(models.includes("GPT-6-Luna") && models.includes("GPT-5.6-Terra"), `Codex's own models: ${models.join(", ")}`);
  assert.ok(!models.includes("GPT-Reserve"), "a model Codex hides stays hidden");
  assert.deepEqual(await menuItems(page.run, "Effort:"), ["The Codex default", "Low", "Max", "Ultra"], "GPT-5.6-Terra's own levels");

  await seedStorage(open, { "kinemi.device.v1": codex("gpt-6-luna") });
  page = await open("/app/settings/providers/");
  assert.deepEqual(await menuItems(page.run, "Effort:"), ["The Codex default", "Low", "Medium", "High", "Extra high", "Max"], "no minimal, up to max");
});

test("Codex answers through this server, and a failure shows only Codex's error", async () => {
  const codex = (model, effort) => JSON.stringify({ assistant: "codex", assistantModels: { codex: model }, assistantEffort: { codex: effort } });
  await seedStorage(open, { "kinemi.device.v1": codex("gpt-6-luna", "max") });
  let { run } = await open("/app/");
  await until(run, "document.querySelector('.composer-row textarea')", "the composer", 10000);
  await say(run, "hi");
  await until(run, `(${LAST_REPLY}).trim() === 'ok'`, "Codex's own answer", 15000);

  await seedStorage(open, { "kinemi.device.v1": codex("broken", "") });
  ({ run } = await open("/app/"));
  await until(run, "document.querySelector('.composer-row textarea')", "the composer", 10000);
  await say(run, "a slow dolly-in on a boxer");
  await until(run, `(${LAST_REPLY}).includes('broken is not available')`, "Codex's error", 15000);
  const last = await run(`(() => { const m = [...document.querySelectorAll('.msg-bot')].at(-1); return { text: m.textContent, call: !!m.querySelector('.call'), buttons: m.querySelectorAll('button').length }; })()`);
  assert.doesNotMatch(last.text, /built-in|answered instead/i, "the built-in rules never answer in Codex's place");
  assert.equal(last.call, false, "no shot card from the built-in rules");
  assert.doesNotMatch(last.text, /rain-soaked|Orbit 30/, "no canned suggestion chips");
});

test("a refused or bridgeless server says why, not that Kinemi isn't running", async () => {
  await seedStorage(open, { "kinemi.device.v1": JSON.stringify({ assistant: "claude-code", assistantModels: {}, assistantEffort: {} }) });
  const { run } = await open("/app/");
  await until(run, "document.querySelector('.composer-row textarea')", "the composer", 10000);
  const answerChatWith = (status, body) =>
    run(`(() => {
      const real = window.fetch;
      window.fetch = (url, init) => String(url).includes('/api/local/chat')
        ? Promise.resolve(new Response(JSON.stringify(${JSON.stringify(body)}), { status: ${status}, headers: { 'Content-Type': 'application/json' } }))
        : real(url, init);
      return true;
    })()`);
  await answerChatWith(403, { error: "host" });
  await say(run, "hi");
  await until(run, `(${LAST_REPLY}).includes('open it at http://localhost')`, "the refused-request hint", 15000);
  assert.doesNotMatch(await run(LAST_REPLY), /isn’t running/, "a refused request is not a stopped server");

  await answerChatWith(503, { ok: false, error: "offline", message: "This Kinemi server has no Claude Code or Codex chat bridge." });
  await say(run, "hello again");
  await until(run, `(${LAST_REPLY}).includes('has no Claude Code or Codex chat bridge')`, "the server's own reason", 15000);
});

test("a chat on OpenRouter asks for the picked effort", async () => {
  const { run } = await openRouterChat(device("xhigh"), ['{"reply":"From the router."}']);
  await say(run, "a slow push-in on a boxer between rounds");
  await until(run, `document.body.textContent.includes('From the router.')`, "the router's answer", 15000);
  const [asked] = await run("window.__asked");
  assert.deepEqual(asked.reasoning, { effort: "xhigh" }, "the level rides in the request");
  assert.equal(asked.model, "openrouter/auto");
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("a level OpenRouter doesn't take is never sent", async () => {
  // max was on offer before each provider got its own list; a browser may still hold it
  const { run } = await openRouterChat(device("max"), ['{"reply":"From the router."}']);
  await say(run, "a slow push-in on a boxer between rounds");
  await until(run, `document.body.textContent.includes('From the router.')`, "the router's answer", 15000);
  const [asked] = await run("window.__asked");
  assert.equal("reasoning" in asked, false, "the router's own default instead of a level it would refuse");
});

test("the system prompt the model reads names the agent, every tool and the approval rule", async () => {
  const { run } = await openRouterChat(device("low"), ['{"reply":"From the router."}']);
  await say(run, "a slow push-in on a boxer between rounds");
  await until(run, `document.body.textContent.includes('From the router.')`, "the router's answer", 15000);
  const [asked] = await run("window.__asked");
  assert.equal(asked.messages[0].role, "system");
  const prompt = asked.messages[0].content;

  assert.match(prompt, /^You are Kinemi, the assistant director of this studio\./);
  assert.match(prompt, /Your job: turn what the director says into one shot the studio can run\./);
  assert.match(prompt, /Renders run on the user's own ComfyUI with open models\./);

  // one "- id (Name): ..." line per tool in the registry, and the count the prompt states matches it
  const listed = [...prompt.matchAll(/^- ([a-z-]+) \([^)]+\): /gm)].map((m) => m[1]);
  assert.deepEqual(listed, TOOLS.map((t) => t.icon), "every tool in the registry, once, in its order");
  assert.equal(TOOLS.length, 16, "the registry holds the studio's 16 tools");
  assert.match(prompt, new RegExp(`one of the ${TOOLS.length} tools below`));
  assert.match(prompt, new RegExp(`any of the ${TOOLS.length} tools, and only these`));

  assert.match(prompt, /a render you ask for waits for the user to approve it, unless they turned YOLO on in Settings/);
  assert.match(prompt, /never say a render is running or finished/);
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("a bare go-ahead from the model points at Approve and never says it is rolling", async () => {
  const { run } = await openRouterChat(device("low"), [
    '{"reply":"Set up.","tool":"cinematic","values":{"text":"a lighthouse at dusk"}}',
    // the model says go and nothing else: the words have to come from what really happens
    '{"render":true}',
  ]);
  await say(run, "a slow dolly-in on a lighthouse");
  await until(run, "!!document.querySelector('.call.is-ready')", "the shot the router set up", 15000);
  await say(run, "render it");
  await until(run, "document.querySelector('.call-approve')", "the approval bar", 15000);
  const reply = await until(run, `(() => { const t = ${LAST_REPLY}; return /Approve/.test(t) && t; })()`, "the reply pointing at Approve", 10000);
  assert.doesNotMatch(reply, /Rolling/, "nothing rolls while the card waits");
  assert.ok(await run("!!document.querySelector('.call.is-ready')"), "the card is set up but not started");
  assert.equal(errors.length, 0, errors.join("\n"));
});

const SET_UP = '{"reply":"Set up.","tool":"cinematic","values":{"text":"a lighthouse at dusk"}}';
const STARTED = "!!document.querySelector('.call.is-queued, .call.is-rendering, .call.is-done')";

/** The reply once it points at Approve, checked never to claim the render is under way. */
async function approvalReply(run) {
  await until(run, "document.querySelector('.call-approve')", "the approval bar", 15000);
  const reply = await until(run, `(() => { const t = ${LAST_REPLY}; return /Approve/.test(t) && t; })()`, "the reply pointing at Approve", 10000);
  assert.doesNotMatch(reply, /Rolling|rendering/i, "the model's claim never shows while the card waits");
  assert.equal(await run(STARTED), false, "nothing started");
}

test("a go-ahead whose words say it is rolling still shows Approve while the card waits", async () => {
  const { run } = await openRouterChat(device("low"), [SET_UP, '{"reply":"Rolling now! It is rendering.","render":true}']);
  await say(run, "a slow dolly-in on a lighthouse");
  await until(run, "!!document.querySelector('.call.is-ready')", "the shot the router set up", 15000);
  await say(run, "render it");
  await approvalReply(run);
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("a new shot asked to render at once waits for Approve, whatever the model wrote", async () => {
  const { run } = await openRouterChat(device("low"), ['{"reply":"Rolling now! It is rendering.","tool":"cinematic","values":{"text":"a lighthouse at dusk"},"render":true}']);
  await say(run, "render a slow dolly-in on a lighthouse");
  await approvalReply(run);
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("after Not now, the model asking for the same shot again never puts up a new card", async () => {
  const sameAgain = '{"reply":"Rolling now!","tool":"cinematic","values":{"text":"a lighthouse at dusk"},"render":true}';
  const { run } = await openRouterChat(device("low"), [SET_UP, '{"render":true}', sameAgain]);
  await say(run, "a slow dolly-in on a lighthouse");
  await until(run, "!!document.querySelector('.call.is-ready')", "the shot the router set up", 15000);
  await say(run, "render it");
  await until(run, "document.querySelector('.call-approve')", "the approval bar", 15000);
  await run("[...document.querySelectorAll('.call-approve button')].find((b) => b.textContent.includes('Not now')).click()");
  await until(run, "!document.querySelector('.call-approve')", "the bar to go after Not now", 5000);

  await say(run, "render it");
  const reply = await until(run, `(() => { const t = ${LAST_REPLY}; return /not now/i.test(t) && t; })()`, "the reply that respects Not now", 15000);
  assert.doesNotMatch(reply, /Rolling/);
  await sleep(500);
  assert.equal(await run("document.querySelectorAll('.call').length"), 1, "no second card for the declined shot");
  assert.equal(await run("!!document.querySelector('.call-approve')"), false, "the declined card stays down");
  assert.equal(await run(STARTED), false, "and nothing started");
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("YOLO switched on while the model thinks leaves that answer waiting for Approve", async () => {
  const { run } = await openRouterChat(device("low"), [SET_UP, '{"reply":"Rolling now!","render":true}'], { holdAt: 2 });
  await say(run, "a slow dolly-in on a lighthouse");
  await until(run, "!!document.querySelector('.call.is-ready')", "the shot the router set up", 15000);
  await say(run, "render it");
  await until(run, "typeof window.__release === 'function'", "the held answer", 10000);

  // switch YOLO on in Settings without a reload, then come back to the chat before the answer lands
  const visit = (path) => `(history.pushState(null, '', '${path}'), dispatchEvent(new PopStateEvent('popstate')), true)`;
  await run(visit("/app/settings/providers/"));
  await until(run, "[...document.querySelectorAll('[role=switch]')].some((b) => b.textContent.includes('Run without asking'))", "the YOLO switch", 10000);
  await run("[...document.querySelectorAll('[role=switch]')].find((b) => b.textContent.includes('Run without asking')).click()");
  await until(run, "JSON.parse(localStorage.getItem('kinemi.device.v1')).yolo === true", "YOLO saved", 5000);
  await run(visit("/app/"));
  await until(run, "!!document.querySelector('.call')", "the chat again", 10000);
  await run("(window.__release(), true)");

  await approvalReply(run);
  assert.equal(errors.length, 0, errors.join("\n"));
});
