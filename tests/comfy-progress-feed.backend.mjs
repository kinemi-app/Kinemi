/**
 * The ComfyUI progress feed (lib/generate/comfy-progress-feed.ts): which socket URL it opens for
 * Comfy Cloud and for a local ComfyUI, when it opens one, how it turns frames into live progress,
 * and how it reconnects. The WebSocket class and the timers are fakes passed through deps; nothing
 * here touches the network or the real clock.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import "./lib/ts-resolve.mjs";

const { createProgressFeed } = await import("../lib/generate/comfy-progress-feed.ts");

const CLIENT_ID = "client-1";
const API_KEY = "cloud-test-key";
const WEIGHTS = { 1: 1, 2: 10 };

/** A socket class whose instances record themselves in `sockets` and let a test fire their events. */
function fakeSocketClass(sockets) {
  return class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.isClosed = false;
      sockets.push(this);
    }
    close() {
      this.isClosed = true;
    }
    send(data) {
      this.dispatchEvent(new MessageEvent("message", { data }));
    }
    drop() {
      this.dispatchEvent(new Event("close"));
    }
  };
}

const IDLE_RUN_MS = 15 * 60_000;

/**
 * Fake sockets and timers for deps. A timer waiting at least the idle window is the feed's sweep and
 * goes to `sweeps`; every shorter one is a reconnect and goes to `timers`. `fire` runs the reconnect
 * timers still pending, as the clock reaching them would; `advance` moves the clock and runs every
 * timer, sweeps included, as it comes due; `pending` lists the timers still waiting.
 */
function fakeWorld() {
  const sockets = [];
  const timers = [];
  const sweeps = [];
  const deps = {
    WebSocket: fakeSocketClass(sockets),
    clientId: CLIENT_ID,
    now: () => world.time,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, at: world.time + ms, isCleared: false };
      (ms >= IDLE_RUN_MS ? sweeps : timers).push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      timer.isCleared = true;
    },
  };
  const fire = () => {
    for (const timer of timers.splice(0).filter((t) => !t.isCleared)) {
      timer.fn();
    }
  };
  const pending = () => [...timers, ...sweeps].filter((timer) => !timer.isCleared);
  const advance = (ms) => {
    const target = world.time + ms;
    for (;;) {
      const due = pending()
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }
      world.time = Math.max(world.time, due.at);
      due.isCleared = true;
      due.fn();
    }
    world.time = target;
  };
  const world = { sockets, timers, sweeps, deps, fire, pending, advance, time: 1000 };
  return world;
}

const cloudConfig = { url: "https://cloud.comfy.org/api", apiKey: API_KEY, isCloud: true };
const localConfig = { url: "http://127.0.0.1:8188", isCloud: false };

function progress(promptId, value) {
  return JSON.stringify({ type: "progress", data: { prompt_id: promptId, node: "2", value, max: 10 } });
}

test("Comfy Cloud's socket is on the host root with the client id and the key as token", () => {
  const world = fakeWorld();
  createProgressFeed(cloudConfig, world.deps).track("p1", WEIGHTS, 1000);
  assert.equal(world.sockets[0].url, `wss://cloud.comfy.org/ws?clientId=${CLIENT_ID}&token=${API_KEY}`);
});

test("a local ComfyUI's socket keeps its base path, swaps the scheme and carries no token", () => {
  const plain = fakeWorld();
  createProgressFeed({ url: "http://host:8188", apiKey: API_KEY, isCloud: false }, plain.deps).track("p1", WEIGHTS, 1000);
  assert.equal(plain.sockets[0].url, `ws://host:8188/ws?clientId=${CLIENT_ID}`);

  const based = fakeWorld();
  createProgressFeed({ url: "https://host/base", isCloud: false }, based.deps).track("p1", WEIGHTS, 1000);
  assert.equal(based.sockets[0].url, `wss://host/base/ws?clientId=${CLIENT_ID}`);
});

test("no socket opens before the first track, and two tracked runs share one", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  assert.equal(world.sockets.length, 0);
  feed.track("p1", WEIGHTS, 1000);
  feed.track("p2", WEIGHTS, 1000);
  assert.equal(world.sockets.length, 1);
});

test("a progress message moves a tracked run and a message for another prompt id creates nothing", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  assert.equal(feed.live("p1")?.fraction, 0);
  world.sockets[0].send(progress("p1", 5));
  assert.ok(feed.live("p1").fraction > 0);
  world.sockets[0].send(progress("other", 5));
  assert.equal(feed.live("other"), undefined);
});

test("binary frames and invalid JSON leave the state as it was", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  const before = feed.live("p1");
  for (const frame of [new Uint8Array([1, 2, 3]).buffer, new Blob(["x"]), Buffer.from("x"), "{not json", "null", "[]"]) {
    world.sockets[0].send(frame);
  }
  assert.deepEqual(feed.live("p1"), before);
  world.sockets[0].send(progress("p1", 5));
  assert.ok(feed.live("p1").fraction > 0);
});

test("after the socket closes a new one opens after 500 ms, then 1000 ms, and keeps tracking", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  world.sockets[0].drop();
  assert.deepEqual(world.timers.map((timer) => timer.ms), [500]);
  world.fire();
  assert.equal(world.sockets.length, 2);
  world.sockets[1].drop();
  assert.deepEqual(world.timers.map((timer) => timer.ms), [1000]);
  world.fire();
  assert.equal(world.sockets.length, 3);
  world.sockets[2].send(progress("p1", 5));
  assert.ok(feed.live("p1").fraction > 0);
});

test("repeated closes without a message wait 500, 1000, 2000, 4000, 8000, then 10000 ms", () => {
  const world = fakeWorld();
  createProgressFeed(localConfig, world.deps).track("p1", WEIGHTS, 1000);
  const delays = [];
  for (let round = 0; round < 7; round += 1) {
    world.sockets.at(-1).drop();
    delays.push(...world.timers.map((timer) => timer.ms));
    world.fire();
  }
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 10_000, 10_000]);
});

test("an open without a message keeps the wait growing, and a message frame resets it to 500 ms", () => {
  const world = fakeWorld();
  createProgressFeed(localConfig, world.deps).track("p1", WEIGHTS, 1000);
  world.sockets[0].drop();
  world.fire();
  world.sockets[1].dispatchEvent(new Event("open"));
  world.sockets[1].drop();
  assert.deepEqual(world.timers.map((timer) => timer.ms), [1000]);
  world.fire();
  world.sockets[2].dispatchEvent(new Event("open"));
  world.sockets[2].drop();
  assert.deepEqual(world.timers.map((timer) => timer.ms), [2000]);
  world.fire();
  world.sockets[3].send(progress("p1", 5));
  world.sockets[3].drop();
  assert.deepEqual(world.timers.map((timer) => timer.ms), [500]);
});

test("forgetting the last run closes the socket without a reconnect, and the next track opens a new one", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  feed.forget("p1");
  assert.equal(world.sockets[0].isClosed, true);
  world.sockets[0].drop();
  assert.equal(world.timers.length, 0);
  feed.track("p2", WEIGHTS, 1000);
  assert.equal(world.sockets.length, 2);
  assert.equal(world.sockets[1].isClosed, false);
});

test("forgetting one of two runs keeps the socket open", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  feed.track("p2", WEIGHTS, 1000);
  feed.forget("p1");
  assert.equal(world.sockets[0].isClosed, false);
  assert.notEqual(feed.live("p2"), undefined);
});

test("a run unread for over 15 minutes is forgotten and the last one closes the socket", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  world.time += IDLE_RUN_MS + 1;
  assert.equal(feed.live("p1"), undefined);
  assert.equal(world.sockets[0].isClosed, true);
  world.sockets[0].drop();
  assert.equal(world.timers.length, 0);
});

test("a run read within 15 minutes survives, and each read starts the window again", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  world.time += IDLE_RUN_MS - 1;
  assert.notEqual(feed.live("p1"), undefined);
  world.time += IDLE_RUN_MS - 1;
  assert.notEqual(feed.live("p1"), undefined);
  assert.equal(world.sockets[0].isClosed, false);
});

test("close() closes the socket and cancels a pending reconnect", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  world.sockets[0].drop();
  assert.equal(world.timers.length, 1);
  feed.close();
  assert.equal(world.timers[0].isCleared, true);
  world.fire();
  assert.equal(world.sockets.length, 1);

  const open = fakeWorld();
  const openFeed = createProgressFeed(localConfig, open.deps);
  openFeed.track("p1", WEIGHTS, 1000);
  openFeed.close();
  assert.equal(open.sockets[0].isClosed, true);
  open.sockets[0].drop();
  assert.equal(open.timers.length, 0);
});

test("forget() makes live() undefined", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  assert.notEqual(feed.live("p1"), undefined);
  feed.forget("p1");
  assert.equal(feed.live("p1"), undefined);
});

const RECONNECT_CAP_MS = 10_000;

test("ComfyUI down: a run nobody reads is forgotten by the timers alone and nothing reconnects after", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  // Every socket closes at once without a frame; only the clock moves, nothing calls track or live.
  for (let waited = 0; waited <= IDLE_RUN_MS + RECONNECT_CAP_MS; waited += RECONNECT_CAP_MS) {
    world.sockets.at(-1).drop();
    world.advance(RECONNECT_CAP_MS);
  }
  // The socket opened last is dropped too: a feed still wanting the run would now wait to reconnect.
  world.sockets.at(-1).drop();
  const opened = world.sockets.length;
  assert.ok(opened > 1);
  assert.deepEqual(world.pending(), []);
  for (let round = 0; round < 3; round += 1) {
    world.advance(RECONNECT_CAP_MS);
    world.sockets.at(-1).drop();
  }
  assert.equal(world.sockets.length, opened);
  assert.deepEqual(world.pending(), []);
  assert.equal(feed.live("p1"), undefined);
});

test("ComfyUI up but quiet: the sweep forgets the run, closes the socket and nothing reconnects", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  world.sockets[0].dispatchEvent(new Event("open"));
  world.advance(IDLE_RUN_MS + 2000);
  assert.equal(world.sockets[0].isClosed, true);
  assert.deepEqual(world.pending(), []);
  world.sockets[0].drop();
  world.advance(IDLE_RUN_MS);
  assert.equal(world.sockets.length, 1);
  assert.equal(world.pending().length, 0);
});

test("the sweep leaves a run read recently alone and arms itself again while runs remain", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  world.advance(IDLE_RUN_MS - 1000);
  assert.notEqual(feed.live("p1"), undefined);
  world.advance(2000 + 1000);
  assert.equal(world.sockets[0].isClosed, false);
  assert.equal(world.pending().length, 1);
  world.advance(IDLE_RUN_MS + 2000);
  assert.equal(world.sockets[0].isClosed, true);
  assert.deepEqual(world.pending(), []);
});

test("a frame after 15 minutes unread forgets the run without any live() call", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  world.time += IDLE_RUN_MS + 1;
  world.sockets[0].send(progress("p1", 5));
  assert.equal(world.sockets[0].isClosed, true);
  assert.deepEqual(world.pending(), []);
  world.sockets[0].drop();
  assert.equal(world.sockets.length, 1);
  assert.equal(feed.live("p1"), undefined);
});

test("forgetting the last run while a reconnect is pending clears it and opens no socket", () => {
  const world = fakeWorld();
  const feed = createProgressFeed(localConfig, world.deps);
  feed.track("p1", WEIGHTS, 1000);
  world.sockets[0].drop();
  assert.equal(world.timers.length, 1);
  feed.forget("p1");
  assert.equal(world.timers[0].isCleared, true);
  assert.deepEqual(world.pending(), []);
  world.advance(IDLE_RUN_MS * 2);
  assert.equal(world.sockets.length, 1);
});

test("close() leaves no timer pending, with a socket open or a reconnect waiting", () => {
  const open = fakeWorld();
  const openFeed = createProgressFeed(localConfig, open.deps);
  openFeed.track("p1", WEIGHTS, 1000);
  assert.equal(open.pending().length, 1);
  openFeed.close();
  assert.deepEqual(open.pending(), []);

  const waiting = fakeWorld();
  const waitingFeed = createProgressFeed(localConfig, waiting.deps);
  waitingFeed.track("p1", WEIGHTS, 1000);
  waiting.sockets[0].drop();
  assert.equal(waiting.pending().length, 2);
  waitingFeed.close();
  assert.deepEqual(waiting.pending(), []);
  waiting.advance(IDLE_RUN_MS * 2);
  assert.equal(waiting.sockets.length, 1);
});

test("a feed still tracking a run never keeps a Node process alive: the sweep is only housekeeping", () => {
  // Real timers in a child process: a sweep that holds the event loop would keep it running 15 minutes.
  const resolver = new URL("./lib/ts-resolve.mjs", import.meta.url).href;
  const feedUrl = new URL("../lib/generate/comfy-progress-feed.ts", import.meta.url).href;
  const script = [
    `import ${JSON.stringify(resolver)};`,
    `const { createProgressFeed } = await import(${JSON.stringify(feedUrl)});`,
    "class Quiet extends EventTarget { close() {} }",
    'const feed = createProgressFeed({ url: "http://127.0.0.1:1", isCloud: false }, { WebSocket: Quiet });',
    'feed.track("p1", { 1: 1 }, Date.now());',
  ].join("\n");
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 10_000 });
  assert.equal(run.signal, null, "the process was still running 10 s after its last line");
  assert.equal(run.status, 0, String(run.stderr));
});
