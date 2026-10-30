/**
 * The arguments the chat's local bridge builds for Claude Code and Codex, including the reasoning
 * effort the studio sends, and the live bridge refusing what must never reach a CLI. No CLI has to be
 * installed: the bridge tests spawn local.mjs against a stand-in script.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { EventEmitter } from "node:events";

import { CLIS, isEffort } from "../web/server/cli.mjs";
import { ask, run, stop } from "../web/server/runner.mjs";
import { EFFORT_LEVELS } from "../web/src/app/prefs.ts";
import { CODEX_MODELS, fakeClaude, fakeCliEnv, SLOW_MS } from "./lib/fake-cli.mjs";
import { freePort } from "./lib/server.mjs";

/** A running child as stop() sees it, recording whether it was killed directly. */
const fakeChild = (state = {}) => ({ pid: 4242, exitCode: null, signalCode: null, killed: 0, kill() { this.killed += 1; }, ...state });
const recordLaunch = (calls) => (cmd, argv, opts) => {
  calls.push({ cmd, argv, opts });
  return new EventEmitter();
};

test("on Windows, stopping a CLI kills its whole process tree, not just the cmd.exe in front of it", () => {
  const calls = [];
  const child = fakeChild();
  stop(child, { win: true, launch: recordLaunch(calls) });
  assert.deepEqual(calls.map((c) => [c.cmd, c.argv]), [["taskkill", ["/pid", "4242", "/T", "/F"]]]);
  assert.equal(child.killed, 0, "the shell alone must not be killed: that orphans the CLI");
});

test("elsewhere stop() kills the child itself, and a child that already ended is left alone", () => {
  const calls = [];
  const child = fakeChild();
  stop(child, { win: false, launch: recordLaunch(calls) });
  assert.equal(child.killed, 1);
  assert.equal(calls.length, 0);
  const ended = fakeChild({ exitCode: 0 });
  stop(ended, { win: true, launch: recordLaunch(calls) });
  assert.equal(calls.length, 0);
  assert.equal(ended.killed, 0);
});

test("a CLI that runs past its time is stopped and reported as a timeout", async () => {
  const started = Date.now();
  await assert.rejects(run("sleep", ["5"], { timeout: 200 }), (e) => e.code === "timeout");
  assert.ok(Date.now() - started < 2000, "the run gave up on time");
});

test("a run whose signal aborts stops its CLI, and an aborted signal never starts one", async () => {
  const gone = new AbortController();
  const started = Date.now();
  const running = run(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { signal: gone.signal });
  setTimeout(() => gone.abort(), 100);
  await assert.rejects(running, (e) => e.code === "stopped");
  assert.ok(Date.now() - started < 2000, "the run stopped when the signal aborted");
  // a command that doesn't exist would reject as not-installed if it were spawned
  await assert.rejects(run("kinemi-no-such-cli", [], { signal: AbortSignal.abort() }), (e) => e.code === "stopped");
});

/** The stand-in's pid once its slow run has started (the file can exist a moment before it holds one). */
async function readPid(folder) {
  let pid = 0;
  const read = () => readFile(join(folder, "slow.pid"), "utf8").catch(() => "");
  await until(async () => (pid = Number(await read())) > 0, 5000, "the CLI to start");
  return pid;
}

test("a turn whose page left while it waited behind another never starts its CLI", async () => {
  const folder = await mkdtemp(join(tmpdir(), "kinemi-queue-"));
  const saved = process.env.KINEMI_CLAUDE_BIN;
  process.env.KINEMI_CLAUDE_BIN = await fakeClaude(folder);
  const request = (model) => ({ id: "claude-code", system: "s", prompt: "p", model, effort: "" });
  try {
    const first = new AbortController();
    const running = ask(request("slow"), { signal: first.signal });
    await readPid(folder);
    const second = new AbortController();
    const waiting = ask(request("second"), { signal: second.signal });
    second.abort();
    first.abort();
    await assert.rejects(running, (e) => e.code === "stopped");
    await assert.rejects(waiting, (e) => e.code === "stopped");
    const runs = (await readFile(join(folder, "runs.log"), "utf8")).trim().split("\n");
    assert.equal(runs.length, 1, "only the first turn ever started a CLI");
  } finally {
    if (saved === undefined) delete process.env.KINEMI_CLAUDE_BIN;
    else process.env.KINEMI_CLAUDE_BIN = saved;
    await rm(folder, { recursive: true, force: true });
  }
});

const args = (id, options) => CLIS[id].args(options);
const flag = (argv, name) => {
  const at = argv.indexOf(name);
  return at < 0 ? undefined : argv[at + 1];
};

test("each CLI takes the effort levels its own binary accepts, and nothing else", () => {
  // claude --help (2.1.309): --effort low, medium, high, xhigh, max
  assert.deepEqual(CLIS["claude-code"].efforts, ["low", "medium", "high", "xhigh", "max"]);
  // Codex's fallback when its model list can't be read: what gpt-6-luna lists (codex 0.155.1)
  assert.deepEqual(CLIS.codex.efforts, ["low", "medium", "high", "xhigh", "max"]);
  for (const id of Object.keys(CLIS)) {
    for (const level of CLIS[id].efforts) assert.equal(isEffort(id, level), true, `${id} ${level}`);
    for (const bad of ["", "none", "ultra", "HIGH", 2, null, undefined]) assert.equal(isEffort(id, bad), false, `${id} ${String(bad)}`);
  }
  assert.equal(isEffort("codex", "max"), true, "Codex takes max");
  assert.equal(isEffort("codex", "minimal"), false, "no Codex model lists minimal");
  assert.equal(isEffort("codex", "ultra", ["low", "ultra"]), true, "a model's own list wins over the fallback");
  assert.equal(isEffort("claude-code", "minimal"), false, "Claude Code has no minimal");
  assert.equal(isEffort("gemini", "low"), false, "an unknown CLI takes no level");
  assert.equal(isEffort("gemini", "low", ["low"]), false, "an unknown CLI takes no level, whatever the list");
});

test("Codex's model list is read with each model's own levels, hidden models and odd levels left out", () => {
  assert.deepEqual(CLIS.codex.modelArgs, ["debug", "models"]);
  assert.deepEqual(CLIS.codex.readModels(JSON.stringify(CODEX_MODELS)), [
    { id: "gpt-6-luna", name: "GPT-6-Luna", efforts: ["low", "medium", "high", "xhigh", "max"], default: "medium" },
    { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", efforts: ["low", "max", "ultra"], default: "medium" },
  ]);
  assert.throws(() => CLIS.codex.readModels("{}"), (e) => e.code === "cli-error");
  assert.equal(CLIS["claude-code"].modelArgs, undefined, "Claude Code takes aliases and lists no models");
});

test("Settings offers each CLI exactly the levels the bridge lets through", () => {
  for (const id of Object.keys(CLIS)) assert.deepEqual(EFFORT_LEVELS[id], CLIS[id].efforts, id);
  assert.equal(EFFORT_LEVELS.openrouter.includes("max"), false, "OpenRouter's reasoning.effort has no max");
});

test("Claude Code is asked for effort with --effort, and left alone without one", () => {
  assert.equal(flag(args("claude-code", { model: "sonnet" }), "--effort"), undefined, "no effort means no flag");
  const argv = args("claude-code", { model: "sonnet", effort: "high" });
  assert.equal(flag(argv, "--effort"), "high");
  assert.equal(flag(argv, "--model"), "sonnet", "the model still arrives");
  assert.equal(flag(argv, "--system-prompt-file"), "system.txt");
  assert.equal(argv[0], "-p", "still a print-mode run with no tools");
  assert.equal(flag(argv, "--tools"), "");
});

test("Codex is asked for effort with a config override, and still reads the prompt on stdin", () => {
  const plain = args("codex", {});
  assert.equal(plain.includes("-c"), false, "no effort means no override");
  assert.equal(plain.at(-1), "-", "the prompt still comes on stdin");

  const argv = args("codex", { model: "gpt-5-codex", effort: "medium" });
  assert.deepEqual(argv.slice(argv.indexOf("-c"), argv.indexOf("-c") + 2), ["-c", "model_reasoning_effort=medium"]);
  assert.equal(flag(argv, "--model"), "gpt-5-codex");
  assert.equal(argv.at(-1), "-");
});

test("each CLI's answer is read the way it prints it", () => {
  const claude = CLIS["claude-code"].read(JSON.stringify({ result: '{"reply":"ok"}', modelUsage: { "claude-sonnet-4-6": 1 } }));
  assert.deepEqual(claude, { text: '{"reply":"ok"}', model: "claude-sonnet-4-6" });

  assert.throws(
    () => CLIS["claude-code"].read(JSON.stringify({ is_error: true, result: "rate limited" })),
    (e) => e.code === "cli-error" && /rate limited/.test(e.message),
  );

  assert.deepEqual(CLIS.codex.read('  {"reply":"ok"}\n'), { text: '{"reply":"ok"}' });
});

/** The local bridge on its own port, as the studio runs it next to the dev server. */
function startBridge(port, env) {
  const child = spawn(process.execPath, ["web/server/local.mjs", "--api-only", "--port", String(port)], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the local bridge did not start")), 15000);
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("Kinemi local API")) return;
      clearTimeout(timer);
      resolve({ stop: () => new Promise((done) => (child.once("close", done), child.kill())) });
    });
    child.once("error", reject);
  });
}

/** Run `use` against a bridge with the stand-in Claude Code; `post` sends one chat request to it. */
async function withBridge(use) {
  const folder = await mkdtemp(join(tmpdir(), "kinemi-bridge-"));
  const port = await freePort();
  const bridge = await startBridge(port, await fakeCliEnv(folder));
  const base = `http://127.0.0.1:${port}/api/local`;
  const post = (body, init = {}) =>
    fetch(`${base}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ provider: "claude-code", system: "s", prompt: "p", ...body }),
      ...init,
    });
  const get = (route) => fetch(`${base}/${route}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
  try {
    await use(post, get, folder);
  } finally {
    await bridge.stop();
    await rm(folder, { recursive: true, force: true });
  }
}

test("the bridge refuses a model that starts with a dash, so it can never pass for a flag", () =>
  withBridge(async (post) => {
    for (const model of ["--dangerously-skip-permissions", "-", "-p"]) {
      const bad = await post({ model });
      assert.equal(bad.status, 400, model);
      assert.deepEqual(await bad.json(), { error: "model" }, `${model} never reaches the CLI`);
    }
    const ok = await post({ model: "claude-sonnet-4-6" });
    assert.equal(ok.status, 200, "a dash inside a model name is fine");
    assert.match(JSON.parse((await ok.json()).text).argv.join(" "), /--model claude-sonnet-4-6/);
  }));

test("the bridge sends the effort to the CLI and refuses a level it doesn't know", () =>
  withBridge(async (post) => {
    const bad = await post({ effort: "minimal" });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "effort" }, "a level this CLI doesn't take never reaches it");

    const top = JSON.parse((await (await post({ effort: "xhigh" })).json()).text);
    assert.match(top.argv.join(" "), /--effort xhigh/, "Claude Code's own xhigh gets through");

    const ok = await post({ effort: "high", model: "sonnet" });
    assert.equal(ok.status, 200);
    const out = await ok.json();
    assert.equal(out.ok, true);
    const seen = JSON.parse(out.text);
    assert.equal(seen.reply, "ok", "the CLI's answer comes back as it printed it");
    assert.match(seen.argv.join(" "), /--effort high/, "the level reached the command line");
    assert.match(seen.argv.join(" "), /--model sonnet/);

    const plain = JSON.parse((await (await post({})).json()).text);
    assert.doesNotMatch(plain.argv.join(" "), /--effort/, "no level chosen means the CLI's own default");
  }));

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Poll until `check` holds, or fail after `ms`. */
async function until(check, ms, what) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("a page that stops waiting stops the CLI on the bridge, and the next turn still answers", () =>
  withBridge(async (post, _get, folder) => {
    const page = new AbortController();
    const asked = post({ model: "slow" }, { signal: page.signal }).catch((e) => e);
    const pid = await readPid(folder);
    page.abort();
    assert.equal((await asked).name, "AbortError");
    await until(() => !isAlive(pid), 2000, "the CLI to be stopped");
    const next = await post({});
    assert.equal(next.status, 200, "the queue is free for the next turn");
    await new Promise((r) => setTimeout(r, SLOW_MS + 300));
    await assert.rejects(readFile(join(folder, "slow.done")), "the stopped CLI never finished its answer");
  }));

test("the bridge lists Codex's models and holds each one to its own levels", () =>
  withBridge(async (post, get) => {
    const st = await (await get("status")).json();
    assert.equal(st.ok, true);
    assert.equal(st.codex.found, true);
    assert.deepEqual(
      st.codex.models.map((m) => [m.id, m.efforts.join(",")]),
      [
        ["gpt-6-luna", "low,medium,high,xhigh,max"],
        ["gpt-5.6-terra", "low,max,ultra"],
      ],
    );
    const codex = (body) => post({ provider: "codex", ...body });

    const max = await codex({ model: "gpt-6-luna", effort: "max" });
    assert.equal(max.status, 200, "Codex's max gets through");
    const seen = JSON.parse((await max.json()).text).argv.join(" ");
    assert.match(seen, /model_reasoning_effort=max/);
    assert.match(seen, /--model gpt-6-luna/);

    const ultra = await codex({ model: "gpt-6-luna", effort: "ultra" });
    assert.equal(ultra.status, 400, "gpt-6-luna doesn't list ultra");
    assert.deepEqual(await ultra.json(), { error: "effort" });
    assert.equal((await codex({ model: "gpt-5.6-terra", effort: "ultra" })).status, 200, "gpt-5.6-terra does");
    assert.equal((await codex({ effort: "ultra" })).status, 200, "with no model, any listed model's level");
    assert.equal((await codex({ effort: "minimal" })).status, 400, "no model lists minimal");
    assert.equal((await codex({ model: "gpt-5.6-terra", effort: "--yolo" })).status, 400, "a level that is a flag never gets through");
  }));
