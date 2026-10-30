/**
 * /api/local/status and /api/local/chat on the Next server (`npm start`): the studio's chat runs
 * Claude Code or Codex on this computer through them (web/src/app/local.ts). They answer only when the
 * launcher bound Next to 127.0.0.1 (lib/runtime/bridge.mjs), and only to this computer's own pages.
 * The CLIs are stand-ins (tests/lib/fake-cli.mjs).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { BOUND_FLAG, nextLaunch } from "../lib/runtime/bridge.mjs";
import { cleanKey } from "../web/src/app/keys.ts";
import { fakeCliEnv } from "./lib/fake-cli.mjs";
import { startServer } from "./lib/server.mjs";

const GOOD_KEY = "comfyui-good-key";
const REDIRECT_KEY = "comfyui-redirect-me";

/**
 * A stand-in for Comfy Cloud's GET /api/user: one key is good, every other one is refused. REDIRECT_KEY
 * gets a redirect to /leak, which records every key that reaches it.
 */
async function fakeCloud() {
  const leaked = [];
  const server = createServer((req, res) => {
    if (req.url === "/leak") leaked.push(req.headers["x-api-key"]);
    if (req.url === "/api/user" && req.headers["x-api-key"] === REDIRECT_KEY) {
      res.writeHead(302, { Location: "/leak" });
      res.end();
      return;
    }
    const good = req.url === "/api/user" && req.headers["x-api-key"] === GOOD_KEY;
    res.writeHead(good ? 200 : 401, { "Content-Type": "application/json" });
    res.end(JSON.stringify(good ? { email: "ada@example.com" } : { message: "invalid key" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, leaked, url: `http://127.0.0.1:${server.address().port}` };
}

/** fetch drops a Host header it is handed, so a forged one goes out through node:http. */
const forgedHost = (app, path, options) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(app.base);
    const req = request({ hostname, port, path, ...options, headers: { Host: "evil.example", ...options.headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on("error", reject);
    req.end(options.body);
  });

let off;
let on;
let folder;
let cloud;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), "kinemi-next-bridge-"));
  const fakes = await fakeCliEnv(folder);
  cloud = await fakeCloud();
  const env = { ...fakes, KINEMI_COMFY_CLOUD_URL: cloud.url };
  // a stale flag in the environment must not switch the bridge on: only the launcher sets it
  off = await startServer({ env: { ...env, KINEMI_LOCAL_CLI: "off", [BOUND_FLAG]: "1" } });
  on = await startServer({ env: { ...env, KINEMI_LOCAL_CLI: "" } });
});
after(async () => {
  off?.stop();
  on?.stop();
  cloud?.server.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});

const chat = (app, body, headers = {}) =>
  fetch(`${app.base}/api/local/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ provider: "claude-code", system: "s", prompt: "p", ...body }),
  });

test("the launcher binds Next to 127.0.0.1 for the bridge, and leaves it alone when told", () => {
  assert.deepEqual(nextLaunch(["-p", "3000"], undefined), { args: ["-p", "3000", "-H", "127.0.0.1"], bound: true });
  assert.deepEqual(nextLaunch(["-p", "3000"], "off"), { args: ["-p", "3000"], bound: false });
  assert.deepEqual(nextLaunch(["-H", "0.0.0.0"], ""), { args: ["-H", "0.0.0.0"], bound: false }, "an open address keeps the bridge off");
  assert.deepEqual(nextLaunch(["--hostname=localhost"], ""), { args: ["--hostname=localhost"], bound: true });
  // Next keeps the last hostname it is given, so the decision must too
  assert.equal(nextLaunch(["-H", "127.0.0.1", "-H", "0.0.0.0"], "").bound, false);
  assert.equal(nextLaunch(["-H", "127.0.0.1", "--hostname=0.0.0.0"], "").bound, false);
  assert.equal(nextLaunch(["-H"], "").bound, false, "a dangling -H is not a loopback address");
});

test("with the bridge off, status reads offline and chat refuses with offline", async () => {
  const status = await fetch(`${off.base}/api/local/status`);
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).error, "offline");
  const res = await chat(off, {});
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "offline", "web/src/app/local.ts reads this as the bridge being off");
});

test("with the bridge on, status lists both CLIs and Codex's models with their levels", async () => {
  const body = await (await fetch(`${on.base}/api/local/status`)).json();
  assert.equal(body.ok, true);
  assert.equal(body.claude.found, true);
  assert.equal(body.codex.found, true);
  assert.deepEqual(
    body.codex.models.map((m) => [m.id, m.efforts.join(",")]),
    [
      ["gpt-6-luna", "low,medium,high,xhigh,max"],
      ["gpt-5.6-terra", "low,max,ultra"],
    ],
  );
});

test("a chat turn runs the CLI with the model and effort, and returns its answer", async () => {
  const claude = await chat(on, { model: "opus", effort: "max" }, { Origin: on.base });
  assert.equal(claude.status, 200);
  const seen = JSON.parse((await claude.json()).text);
  assert.equal(seen.reply, "ok");
  assert.match(seen.argv.join(" "), /--effort max/);
  assert.match(seen.argv.join(" "), /--model opus/);

  const codex = await chat(on, { provider: "codex", model: "gpt-6-luna", effort: "max" });
  assert.equal(codex.status, 200);
  assert.match(JSON.parse((await codex.json()).text).argv.join(" "), /model_reasoning_effort=max/);

  assert.equal((await chat(on, { provider: "codex", model: "gpt-6-luna", effort: "ultra" })).status, 400, "gpt-6-luna lists no ultra");
  assert.equal((await chat(on, { model: "--dangerously-skip-permissions" })).status, 400);
  assert.equal((await chat(on, { provider: "bash" })).status, 400);
});

test("another site, or a forged Host, never reaches the CLIs", async () => {
  const evil = await chat(on, {}, { Origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.deepEqual(await evil.json(), { error: "origin" });
  const forged = await forgedHost(on, "/api/local/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "claude-code", system: "s", prompt: "p" }),
  });
  assert.equal(forged.status, 403);
  assert.deepEqual(JSON.parse(forged.body), { error: "host" });
  const text = await fetch(`${on.base}/api/local/chat`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(text.status, 415, "only JSON is taken, so a plain form post can't reach it");
});

const checkKey = (app, key, headers = {}) => fetch(`${app.base}/api/local/comfycloud`, { headers: key === undefined ? headers : { "X-API-Key": key, ...headers } });

test("a pasted key loses the quotes and spaces around it, and nothing inside it", () => {
  for (const pasted of [GOOD_KEY, ` ${GOOD_KEY}\n`, `"${GOOD_KEY}"`, `${GOOD_KEY}"`, `'${GOOD_KEY}'`, `\`${GOOD_KEY}\``, ` "${GOOD_KEY}" `, `“${GOOD_KEY}”`]) {
    assert.equal(cleanKey(pasted), GOOD_KEY, JSON.stringify(pasted));
  }
  assert.equal(cleanKey('sk-"inner"-key'), 'sk-"inner"-key');
  assert.equal(cleanKey('""'), "");
});

test("npm start checks a Comfy Cloud key through the server, so Settings → Test works", async () => {
  const good = await checkKey(on, GOOD_KEY, { Origin: on.base });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("x-kinemi-proxy"), "1", "web/src/app/compute.ts only trusts answers with this header");
  assert.equal((await good.json()).email, "ada@example.com");

  const quoted = await checkKey(on, `"${GOOD_KEY}"`);
  assert.equal(quoted.status, 200, "a key pasted with its quotes still reaches Cloud without them");

  const bad = await checkKey(on, "comfyui-bad-key");
  assert.equal(bad.status, 401, "Cloud's refusal comes back as it is");
  assert.equal(bad.headers.get("x-kinemi-proxy"), "1");

  const none = await checkKey(on, undefined);
  assert.equal(none.status, 400);
  assert.equal(none.headers.get("x-kinemi-proxy"), "1");
  assert.equal((await checkKey(on, "x".repeat(401))).status, 400, "an oversized key is never sent on");
});

test("a redirect from Cloud never carries the key on, and reads as unreachable", async () => {
  const res = await checkKey(on, REDIRECT_KEY);
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("x-kinemi-proxy"), "1", "the studio shows 'Couldn't reach Comfy Cloud'");
  assert.deepEqual(cloud.leaked, [], "the key reached the redirect target");
});

test("the key check keeps other sites out, and is off with the bridge", async () => {
  const evil = await checkKey(on, GOOD_KEY, { Origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get("x-kinemi-proxy"), null);

  const forged = await forgedHost(on, "/api/local/comfycloud", { method: "GET", headers: { "X-API-Key": GOOD_KEY } });
  assert.equal(forged.status, 403);
  assert.equal(forged.headers["x-kinemi-proxy"], undefined);

  const offline = await checkKey(off, GOOD_KEY);
  assert.equal((await offline.json()).error, "offline");
  assert.equal(offline.headers.get("x-kinemi-proxy"), null, "with no proxy header the studio says to start Kinemi with npm start");
});
