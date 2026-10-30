/**
 * Live progress of a ComfyUI run (lib/generate/comfy-progress.ts) and the Comfy Cloud price
 * (lib/generate/comfy-cost.ts): the reducer turns the WebSocket frames of one prompt into a weighted
 * fraction that never falls, a message while queued, the time left at the pace the sampler steps
 * really took, and the GPU time. Every value comes from the frames or the published rate.
 *
 * Replays tests/fixtures/comfy-ws-wan22.json, a synthetic wan22 run with exact arithmetic: ten
 * nodes of weight 28 (two samplers of 10 steps, eight others), four of them cached, 500 ms a step.
 * The clock is the `t` of each frame; nothing here reads the real clock or the network.
 *
 * The last test replays tests/fixtures/comfy-ws-wan22-cloud.json, frames recorded from a real Comfy
 * Cloud run. There Cloud sends progress_state just before each progress frame, and the first step's
 * pace includes model loading, so time left is only checked from the second step on.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import "./lib/ts-resolve.mjs";

const progress = await import("../lib/generate/comfy-progress.ts");
const cost = await import("../lib/generate/comfy-cost.ts");

const fixture = JSON.parse(readFileSync(new URL("./fixtures/comfy-ws-wan22.json", import.meta.url), "utf8"));
const PROMPT = fixture.promptId;
const TOTAL_WEIGHT = 28;
const CACHED_WEIGHT = 4;
const STEP_MS = 500;
const QUEUE_TEXT = "Waiting for a machine…";
/** Worst real miss after the first step was 5.2 s, between the two samplers while a model loads. */
const REAL_REMAINING_TOLERANCE_MS = 10_000;

function freshState(weights = progress.graphWeights(fixture.graph)) {
  return progress.createRunState({ promptId: PROMPT, weights, queuedAt: 0, source: "cloud" });
}

/** Applies each frame at its own `t`; one row per frame with the state and live view after it. */
function trace(messages = fixture.messages, start = freshState()) {
  let state = start;
  return messages.map((msg) => {
    state = progress.applyMessage(state, msg, msg.t);
    return { msg, state, live: progress.liveOf(state, msg.t) };
  });
}

function isStepOfRun(row) {
  return row.msg.type === "progress" && row.msg.data.prompt_id === PROMPT;
}

function assertNear(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} is not ${expected}`);
}

test("replaying the fixture: the fraction rises at every progress step, never falls, and is exactly 1 on success", () => {
  const rows = trace();
  let previous = 0;
  for (const row of rows) {
    assert.ok(row.live.fraction >= previous, `fell at t=${row.msg.t} (${row.msg.type})`);
    if (isStepOfRun(row)) {
      assert.ok(row.live.fraction > previous, `did not rise at t=${row.msg.t}`);
    }
    previous = row.live.fraction;
  }
  const steps = rows.filter(isStepOfRun);
  assert.equal(steps.length, 20);
  assertNear(steps[0].live.fraction, (CACHED_WEIGHT + 2 + 1) / TOTAL_WEIGHT, "first step of the first sampler");
  assertNear(steps[9].live.fraction, (CACHED_WEIGHT + 2 + 10) / TOTAL_WEIGHT, "last step of the first sampler");
  assertNear(steps[19].live.fraction, (CACHED_WEIGHT + 2 + 20) / TOTAL_WEIGHT, "last step of the second sampler");
  assert.equal(steps[0].live.step, 1);
  assert.equal(steps[0].live.steps, 10);
  assert.equal(steps[0].live.node, "7");

  const last = rows.at(-1).live;
  assert.equal(last.phase, "done");
  assert.equal(last.fraction, 1);
  assert.equal(last.endedAt, 13000);
});

test("execution_success sets the fraction to exactly 1 even when nodes were still unfinished", () => {
  const withoutLastNode = fixture.messages.filter((msg) => !(msg.type === "executed" && msg.data.node === "10"));
  const rows = trace(withoutLastNode);
  const beforeSuccess = rows.at(-2).live;
  assert.ok(beforeSuccess.fraction < 1, `already ${beforeSuccess.fraction} before success`);
  assert.equal(beforeSuccess.phase, "running");
  assert.equal(rows.at(-1).live.fraction, 1);
  assert.equal(rows.at(-1).live.phase, "done");
});

test("before execution_start the run is queued with the notification text; execution_start starts the clock", () => {
  const rows = trace();
  assert.equal(rows[0].msg.type, "notification");
  assert.equal(rows[0].live.phase, "queued");
  assert.equal(rows[0].live.message, QUEUE_TEXT);
  assert.equal(rows[0].live.startedAt, undefined);
  assert.equal(rows[0].live.gpuMs, 0);
  assert.equal(rows[0].live.fraction, 0);

  assert.equal(rows[1].msg.type, "execution_start");
  assert.equal(rows[1].live.phase, "running");
  assert.equal(rows[1].live.startedAt, 2000);
  assert.equal(rows[1].live.message, undefined);

  const late = progress.applyMessage(rows[1].state, { type: "notification", data: { value: "Late news" } }, 2500);
  assert.equal(late, rows[1].state, "a notification after the start must not bring the message back");

  const fromOtherPrompt = progress.applyMessage(
    freshState(),
    { type: "notification", data: { prompt_id: "p-other", value: "Not mine" } },
    10,
  );
  assert.equal(progress.liveOf(fromOtherPrompt, 10).message, undefined);
});

test("remainingMs is undefined before the first finished step, positive and shrinking at a steady rate, undefined when done", () => {
  const rows = trace();
  const firstStep = rows.findIndex(isStepOfRun);
  for (const row of rows.slice(0, firstStep)) {
    assert.equal(row.live.remainingMs, undefined, `known too early at t=${row.msg.t} (${row.msg.type})`);
  }

  const remaining = rows.filter(isStepOfRun).map((row) => row.live.remainingMs);
  remaining.forEach((value, index) => {
    assert.ok(value !== undefined && value > 0, `step ${index + 1}: ${value}`);
    if (index > 0) {
      assert.ok(value < remaining[index - 1], `step ${index + 1} did not shrink: ${value}`);
    }
  });
  // 500 ms a weight unit: 28 minus the weight done so far, times 500.
  assertNear(remaining[0], (TOTAL_WEIGHT - 7) * STEP_MS, "after the first step");
  assertNear(remaining[9], (TOTAL_WEIGHT - 16) * STEP_MS, "after the first sampler");
  assertNear(remaining[19], (TOTAL_WEIGHT - 26) * STEP_MS, "after the last step");

  assert.equal(rows.at(-1).live.remainingMs, undefined);
});

test("remainingMs follows the measured pace: the same run at half speed leaves twice the time", () => {
  const slow = fixture.messages.map((msg) => ({ ...msg, t: msg.t * 2 }));
  const fastFirst = trace().find(isStepOfRun).live.remainingMs;
  const slowFirst = trace(slow).find(isStepOfRun).live.remainingMs;
  assertNear(slowFirst, fastFirst * 2, "remaining at half speed");
});

test("cached nodes count their full weight, once", () => {
  const rows = trace();
  const cachedRow = rows.find((row) => row.msg.type === "execution_cached");
  assertNear(cachedRow.live.fraction, CACHED_WEIGHT / TOTAL_WEIGHT, "after execution_cached");

  const weights = { a: 10, b: 1, c: 1 };
  let state = progress.applyMessage(
    freshState(weights),
    { type: "execution_cached", data: { prompt_id: PROMPT, nodes: ["a", "not-in-the-graph"] } },
    0,
  );
  assertNear(progress.liveOf(state, 0).fraction, 10 / 12, "a cached sampler");
  state = progress.applyMessage(state, { type: "executed", data: { prompt_id: PROMPT, node: "a" } }, 5);
  assertNear(progress.liveOf(state, 5).fraction, 10 / 12, "a cached node reported again");
});

test("messages for another prompt_id leave the state unchanged", () => {
  const running = trace(fixture.messages.slice(0, 11)).at(-1).state;
  const foreign = [
    { type: "execution_start", data: { prompt_id: "p-other" } },
    { type: "execution_cached", data: { prompt_id: "p-other", nodes: ["1", "2", "3", "4", "5"] } },
    { type: "executing", data: { prompt_id: "p-other", node: "8" } },
    { type: "progress", data: { prompt_id: "p-other", node: "7", value: 9, max: 10 } },
    { type: "progress_state", data: { prompt_id: "p-other", nodes: { 7: { state: "finished" } } } },
    { type: "executed", data: { prompt_id: "p-other", node: "7" } },
    { type: "notification", data: { prompt_id: "p-other", value: "Not mine" } },
    { type: "execution_error", data: { prompt_id: "p-other", exception_message: "boom" } },
    { type: "execution_success", data: { prompt_id: "p-other" } },
  ];
  for (const start of [freshState(), running]) {
    for (const msg of foreign) {
      assert.equal(progress.applyMessage(start, msg, 9999), start, `${msg.type} changed the state`);
    }
  }
});

test("malformed data never throws and changes nothing", () => {
  const p = PROMPT;
  const malformed = [
    { type: "progress", data: { prompt_id: p, node: "7", value: "5", max: "10" } },
    { type: "progress", data: { prompt_id: p } },
    { type: "progress", data: { prompt_id: p, node: "7", value: 3, max: 0 } },
    { type: "progress", data: { prompt_id: p, node: "7", value: Number.NaN, max: 10 } },
    { type: "progress", data: { prompt_id: p, node: "7", value: 1, max: Number.POSITIVE_INFINITY } },
    { type: "progress_state", data: { prompt_id: p } },
    { type: "progress_state", data: { prompt_id: p, nodes: "none" } },
    { type: "progress_state", data: { prompt_id: p, nodes: { 7: null, 8: { state: "weird" } } } },
    { type: "progress_state", data: { prompt_id: p, nodes: { 7: { state: "running", value: "1", max: "10" } } } },
    { type: "executing", data: { prompt_id: p } },
    { type: "executing", data: { prompt_id: p, node: 7 } },
    { type: "executed", data: { prompt_id: p } },
    { type: "executed", data: { prompt_id: p, node: 7 } },
    { type: "execution_cached", data: { prompt_id: p } },
    { type: "execution_cached", data: { prompt_id: p, nodes: "1,2" } },
    { type: "execution_cached", data: { prompt_id: p, nodes: [1, null, {}] } },
    { type: "notification", data: { value: 5 } },
    { type: "notification" },
    { type: "crystal_ball", data: { prompt_id: p, value: 1 } },
    { type: "status", data: { status: { exec_info: { queue_remaining: 1 } } } },
    { type: "progress", data: "oops" },
    { type: "progress", data: null },
    { type: "progress", data: [1, 2] },
    { type: "progress" },
    { type: 5, data: { prompt_id: p } },
    { data: { prompt_id: p } },
    null,
    undefined,
    "progress",
    42,
  ];
  const midRun = trace(fixture.messages.slice(0, 11)).at(-1).state;
  for (const start of [freshState(), midRun, freshState({})]) {
    for (const msg of malformed) {
      let next;
      assert.doesNotThrow(() => {
        next = progress.applyMessage(start, msg, 9999);
      }, JSON.stringify(msg));
      assert.equal(next, start, `changed the state: ${JSON.stringify(msg)}`);
    }
  }
});

test("execution_error ends the run with its message and keeps the fraction", () => {
  const upToStepFour = fixture.messages.slice(0, 12);
  const before = trace(upToStepFour).at(-1);
  assert.equal(before.live.phase, "running");

  const failed = progress.applyMessage(
    before.state,
    { type: "execution_error", data: { prompt_id: PROMPT, exception_message: "CUDA out of memory" } },
    4500,
  );
  const live = progress.liveOf(failed, 4500);
  assert.equal(live.phase, "done");
  assert.equal(live.message, "CUDA out of memory");
  assert.equal(live.fraction, before.live.fraction);
  assert.equal(live.endedAt, 4500);
  assert.equal(live.remainingMs, undefined);

  const afterwards = progress.applyMessage(failed, { type: "execution_success", data: { prompt_id: PROMPT } }, 5000);
  assert.equal(afterwards, failed, "a finished run takes no more messages");

  const noReason = progress.applyMessage(before.state, { type: "execution_error", data: { prompt_id: PROMPT } }, 4500);
  const noReasonLive = progress.liveOf(noReason, 4500);
  assert.equal(noReasonLive.phase, "done");
  assert.equal(typeof noReasonLive.message, "string");
  assert.ok(noReasonLive.message.length > 0);
  assert.equal(noReasonLive.fraction, before.live.fraction);
});

test("gpuMs is endedAt − startedAt after success, now − startedAt while running, else 0", () => {
  const rows = trace();
  assert.equal(rows[0].live.gpuMs, 0);
  assert.equal(rows[1].live.gpuMs, 0);
  const midStep = rows.find(isStepOfRun);
  assert.equal(midStep.live.gpuMs, midStep.msg.t - 2000);
  assert.equal(progress.liveOf(midStep.state, 4000).gpuMs, 2000);

  const done = rows.at(-1);
  assert.equal(done.live.startedAt, 2000);
  assert.equal(done.live.endedAt, 13000);
  assert.equal(done.live.gpuMs, 11000);
  assert.equal(progress.liveOf(done.state, 99_999).gpuMs, 11000, "a finished run stops counting");
});

test("cloudCredits and creditsFromUsd follow the published rate", () => {
  assert.equal(cost.CLOUD_CREDITS_PER_GPU_HOUR, 736.39);
  assert.equal(cost.CLOUD_USD_PER_GPU_HOUR, 3.49);
  assert.equal(cost.cloudCredits(3_600_000), 736.39);
  assert.equal(cost.cloudCredits(0), 0);
  assertNear(cost.cloudCredits(1_800_000), 736.39 / 2, "half an hour");
  assertNear(cost.creditsFromUsd(3.49), 736.39, "one GPU hour in dollars");
  assertNear(cost.creditsFromUsd(0), 0, "no dollars");
});

test("graphWeights weighs a sampler by its steps and every other node as one", () => {
  const weights = progress.graphWeights(fixture.graph);
  assert.equal(weights["7"], 10);
  assert.equal(weights["8"], 10);
  for (const id of ["1", "2", "3", "4", "5", "6", "9", "10"]) {
    assert.equal(weights[id], 1, `node ${id}`);
  }
  assert.equal(Object.values(weights).reduce((sum, weight) => sum + weight, 0), TOTAL_WEIGHT);

  const odd = progress.graphWeights({
    zero: { inputs: { steps: 0 } },
    negative: { inputs: { steps: -4 } },
    text: { inputs: { steps: "20" } },
    bare: {},
  });
  assert.deepEqual(odd, { zero: 1, negative: 1, text: 1, bare: 1 });
});

test("an empty graph (total weight 0) never yields NaN", () => {
  const frames = [
    { type: "notification", data: { value: QUEUE_TEXT } },
    { type: "execution_start", data: { prompt_id: PROMPT } },
    { type: "progress", data: { prompt_id: PROMPT, node: "x", value: 1, max: 2 } },
    { type: "executed", data: { prompt_id: PROMPT, node: "x" } },
    { type: "execution_success", data: { prompt_id: PROMPT } },
  ];
  assert.deepEqual(progress.graphWeights({}), {});
  for (const weights of [{}, { lonely: 0 }]) {
    let state = freshState(weights);
    frames.forEach((msg, index) => {
      state = progress.applyMessage(state, msg, 1000 * (index + 1));
      const live = progress.liveOf(state, 1000 * (index + 1));
      for (const [key, value] of Object.entries(live)) {
        assert.ok(typeof value !== "number" || Number.isFinite(value), `${key} is ${value} after ${msg.type}`);
      }
    });
    assert.equal(progress.liveOf(state, 9999).fraction, 1);
  }
});

test("replaying a real Comfy Cloud wan22 run: Cloud's queue text, a rise at all 20 steps, honest time left, 1 at success", () => {
  const real = JSON.parse(readFileSync(new URL("./fixtures/comfy-ws-wan22-cloud.json", import.meta.url), "utf8"));
  const weights = progress.graphWeights(real.graph);
  let state = progress.createRunState({ promptId: real.promptId, weights, queuedAt: 0, source: "cloud" });
  const successAt = real.messages.find((msg) => msg.type === "execution_success").t;
  const startAt = real.messages.find((msg) => msg.type === "execution_start").t;
  const steps = [];
  let previous = 0;
  let queueText;
  for (const msg of real.messages) {
    state = progress.applyMessage(state, msg, msg.t);
    const live = progress.liveOf(state, msg.t);
    assert.ok(live.fraction >= previous, `fell at t=${msg.t} (${msg.type})`);
    previous = live.fraction;
    if (live.phase === "queued" && live.message) {
      queueText = live.message;
    }
    if (msg.type === "progress") {
      steps.push({ t: msg.t, live });
    }
  }

  assert.equal(queueText, "Waiting for a machine... (Usually a few seconds)");
  assert.equal(steps.length, 20);
  steps.forEach(({ t, live }, index) => {
    assert.equal(live.step, (index % 10) + 1, `step at t=${t}`);
    assert.equal(live.steps, 10);
    if (index > 0) {
      assert.ok(live.fraction > steps[index - 1].live.fraction, `no rise at t=${t}`);
      const error = Math.abs(live.remainingMs - (successAt - t));
      assert.ok(error < REAL_REMAINING_TOLERANCE_MS, `time left off by ${error} ms at t=${t}`);
    }
  });

  const done = progress.liveOf(state, successAt);
  assert.equal(done.phase, "done");
  assert.equal(done.fraction, 1);
  assert.equal(done.gpuMs, successAt - startAt);
});
