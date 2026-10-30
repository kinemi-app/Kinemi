#!/usr/bin/env node

/**
 * Kinemi's command line. It talks to a running app: start one with `npm run start` (or `npm run
 * dev`) and point --base at it. `schedule` works offline.
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { CRON_FIELDS, SCHEDULES, isDue, readSchedules, writeSchedules } from "./schedules.mjs";

const HOME = join(homedir(), ".kinemi");
const DEFAULT_BASE = process.env.KINEMI_BASE ?? "http://localhost:4321";
const POLL_MS = 700;
const REQUEST_TIMEOUT_MS = 20000;
const JOB_TIMEOUT_MS = 120000;
const DEFAULT_CONCURRENCY = 2;

const USAGE = `kinemi - plan and run campaigns against a Kinemi server

  kinemi plan --brief "text" [--out plan.json] [--base url]
  kinemi batch --plan plan.json [--concurrency 2] [--base url] [--dry-run]
  kinemi run plan.json [--base url]
  kinemi status <jobId> [--base url]
  kinemi schedule add --cron "0 9 * * *" --plan plan.json [--name text] [--base url]
  kinemi schedule run-due [--notify slack,notion,drive]
  kinemi schedule list
  kinemi schedule print
  kinemi schedule remove --id <id>

The server base defaults to ${DEFAULT_BASE}, or KINEMI_BASE.
Schedules live in ${SCHEDULES}; nothing is installed into your crontab by this tool.`;

function fail(message, code = 1) {
  console.error(message);
  process.exitCode = code;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split("=");
    if (inline !== undefined) {
      args[key] = inline;
    } else if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function request(base, path, init) {
  let response;
  try {
    response = await fetch(new URL(path, base), {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      throw new Error(`${path} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw cause;
  }
  const text = await response.text();
  let body;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const reason = body && typeof body.error === "string" ? `: ${body.error}` : "";
    throw new Error(`${path} answered ${response.status}${reason}`);
  }
  return body;
}

function postJson(base, path, payload) {
  return request(base, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** A result URL may be relative to the server (a cloud render's /api/comfy/view link); print it whole. */
function fullUrl(url, base) {
  return typeof url === "string" && url !== "" ? new URL(url, base).toString() : undefined;
}

function readBase(args) {
  const base = typeof args.base === "string" ? args.base : DEFAULT_BASE;
  try {
    return new URL(base).toString();
  } catch {
    throw new Error(`--base "${base}" is not a URL`);
  }
}

async function commandPlan(args) {
  const brief = args.brief;
  if (typeof brief !== "string" || brief.trim().length < 12) {
    return fail("plan needs --brief with at least 12 characters\n\n" + USAGE, 2);
  }

  const body = await postJson(readBase(args), "/api/studio/plan", { brief });
  const shots = Array.isArray(body?.shots) ? body.shots : [];
  for (const shot of shots) {
    console.log(`${shot.index}. ${shot.title} · ${shot.mode} · ${shot.durationS}s · ${shot.modelId}`);
    console.log(`   ${shot.prompt}`);
  }
  if (typeof args.out === "string") {
    const path = resolve(args.out);
    await writeFile(path, `${JSON.stringify(shots, null, 2)}\n`);
    console.log(`\n${shots.length} shots written to ${path}`);
  }
}

async function runShot(shot, base) {
  const started = Date.now();
  const accepted = await postJson(base, "/api/generate", {
    mode: shot.mode,
    modelId: shot.modelId,
    prompt: shot.prompt,
    durationS: shot.durationS,
  });

  for (;;) {
    await sleep(POLL_MS);
    const job = await request(base, `/api/jobs/${accepted.jobId}`);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (job.status === "succeeded") {
      return {
        ok: true,
        status: "succeeded",
        title: shot.title,
        url: fullUrl(job.result?.url, base),
        line: `${shot.index}. ${shot.title} · ok · ${seconds}s`,
      };
    }
    if (job.status === "failed") {
      return {
        ok: false,
        status: "failed",
        title: shot.title,
        error: job.error ?? "no reason",
        line: `${shot.index}. ${shot.title} · failed · ${job.error ?? "no reason"}`,
      };
    }
    if (Date.now() - started > JOB_TIMEOUT_MS) {
      return {
        ok: false,
        status: "timed out",
        title: shot.title,
        line: `${shot.index}. ${shot.title} · timed out after ${seconds}s`,
      };
    }
  }
}

async function loadShots(planPath) {
  const raw = JSON.parse(await readFile(resolve(planPath), "utf8"));
  const shots = Array.isArray(raw) ? raw : raw?.shots;
  if (!Array.isArray(shots) || shots.length === 0) {
    throw new Error(`${planPath} holds no shots`);
  }
  for (const shot of shots) {
    if (typeof shot.mode !== "string" || typeof shot.modelId !== "string" || typeof shot.prompt !== "string") {
      throw new Error(`${planPath} has a shot without mode, modelId or prompt`);
    }
  }
  return shots;
}

async function runBatch(shots, base, limit) {
  console.log(`${shots.length} shots, ${limit} at a time, against ${base}`);

  let cursor = 0;
  const results = new Array(shots.length);
  async function worker() {
    while (cursor < shots.length) {
      const index = cursor;
      cursor += 1;
      const shot = shots[index];
      try {
        results[index] = await runShot(shot, base);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        results[index] = {
          ok: false,
          status: "failed",
          title: shot.title,
          error: reason,
          line: `${shot.index}. ${shot.title} · failed · ${reason}`,
        };
      }
      console.log(results[index].line);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, shots.length) }, worker));
  return results;
}

function summarize(results, total) {
  const ok = results.filter((result) => result.ok).length;
  console.log(`\n${ok}/${total} succeeded`);
  if (ok !== total) {
    process.exitCode = 1;
  }
}

async function commandBatch(args) {
  if (typeof args.plan !== "string") {
    return fail("batch needs --plan <file>\n\n" + USAGE, 2);
  }

  let shots;
  try {
    shots = await loadShots(args.plan);
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }

  if (args["dry-run"]) {
    console.log(`${shots.length} shots valid: ${shots.map((shot) => shot.mode).join(", ")}`);
    return;
  }

  const base = readBase(args);
  const limit = Math.min(8, Math.max(1, Number(args.concurrency ?? DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY));
  const results = await runBatch(shots, base, limit);
  summarize(results, shots.length);
}

async function commandRun(args) {
  const planPath = args._[1];
  if (typeof planPath !== "string" || planPath === "") {
    return fail("run needs a plan file\n\n" + USAGE, 2);
  }

  let shots;
  try {
    shots = await loadShots(planPath);
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }

  const base = readBase(args);
  const results = [];
  for (const shot of shots) {
    let result;
    try {
      result = await runShot(shot, base);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      result = {
        ok: false,
        status: "failed",
        title: shot.title,
        error: reason,
        line: `${shot.index}. ${shot.title} · failed · ${reason}`,
      };
    }
    console.log(`${shot.index}. ${shot.title} · ${result.status}${result.url ? ` · ${result.url}` : ""}`);
    results.push(result);
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

async function commandStatus(args) {
  const jobId = args._[1];
  if (typeof jobId !== "string" || jobId === "") {
    return fail("status needs a job id\n\n" + USAGE, 2);
  }

  const base = readBase(args);
  const job = await request(base, `/api/jobs/${encodeURIComponent(jobId)}`);
  console.log(job.status);
  const resultUrl = fullUrl(job.result?.url, base);
  if (resultUrl) {
    console.log(resultUrl);
  } else if (typeof job.error === "string" && job.error !== "") {
    console.log(job.error);
  }
  if (job.status === "failed") {
    process.exitCode = 1;
  }
}

const NOTIFY_TARGETS = ["slack", "notion", "drive"];

/** Run every due plan through the batch path, then announce the finished jobs to --notify. */
async function commandRunDue(args) {
  const requested =
    typeof args.notify === "string"
      ? args.notify.split(",").map((target) => target.trim()).filter((target) => target !== "")
      : [];
  const unknown = requested.find((target) => !NOTIFY_TARGETS.includes(target));
  if (unknown !== undefined) {
    return fail(`unknown --notify target "${unknown}"; use slack, notion or drive`, 2);
  }

  const due = (await readSchedules()).filter((entry) => isDue(entry, new Date()));
  if (due.length === 0) {
    console.log("no schedules are due");
    return;
  }

  const finished = [];
  let failed = false;
  for (const entry of due) {
    let shots;
    try {
      shots = await loadShots(entry.plan);
    } catch (cause) {
      console.error(`schedule ${entry.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      failed = true;
      continue;
    }
    console.log(`schedule ${entry.id} · ${entry.name ?? entry.plan}`);
    const results = await runBatch(shots, entry.base ?? DEFAULT_BASE, DEFAULT_CONCURRENCY);
    if (results.some((result) => !result.ok)) {
      failed = true;
    }
    for (const result of results) {
      finished.push(`${result.title} · ${result.status}${result.url ? ` · ${result.url}` : ""}`);
    }
  }

  if (requested.length === 0 || finished.length === 0) {
    if (failed) process.exitCode = 1;
    return;
  }

  let connectors;
  try {
    // bin runs under bare node; type stripping needs Node 22.18 or newer, so load it only here.
    connectors = await import("../lib/studio/connectors.ts");
  } catch {
    return fail("connectors need Node 22.18 or newer (TypeScript type stripping)");
  }
  const configured = connectors.configuredTargets();
  for (const target of requested) {
    if (!configured.includes(target)) {
      console.log(`skipped ${target}: not configured`);
      continue;
    }
    try {
      await connectors.publish(target, { title: "Kinemi schedule run", text: finished.join("\n") });
      console.log(`published ${target}`);
    } catch (cause) {
      console.error(`${target}: ${cause instanceof Error ? cause.message : String(cause)}`);
      failed = true;
    }
  }
  if (failed) {
    process.exitCode = 1;
  }
}

function cronLine(entry) {
  const plan = entry.plan;
  return `${entry.cron} cd ${process.cwd()} && node bin/kinemi.mjs batch --plan "${plan}" --base ${entry.base} >> "${join(HOME, `${entry.id}.log`)}" 2>&1`;
}

async function commandSchedule(args) {
  const action = args._[1] ?? "list";
  if (action === "run-due") {
    return commandRunDue(args);
  }

  const entries = await readSchedules();

  if (action === "list") {
    if (entries.length === 0) {
      console.log(`no schedules in ${SCHEDULES}`);
      return;
    }
    for (const entry of entries) {
      console.log(`${entry.id}  ${entry.cron}  ${entry.name ?? "(unnamed)"}  ${entry.plan}`);
    }
    return;
  }

  if (action === "print") {
    for (const entry of entries) {
      console.log(cronLine(entry));
    }
    return;
  }

  if (action === "add") {
    const cron = args.cron;
    if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== CRON_FIELDS) {
      return fail(`schedule add needs --cron with ${CRON_FIELDS} fields, for example "0 9 * * *"`, 2);
    }
    if (typeof args.plan !== "string") {
      return fail("schedule add needs --plan <file>", 2);
    }
    const entry = {
      id: randomUUID().slice(0, 8),
      cron: cron.trim(),
      plan: resolve(args.plan),
      base: readBase(args),
      name: typeof args.name === "string" ? args.name : undefined,
    };
    await writeSchedules([...entries, entry]);
    console.log(`added ${entry.id}`);
    console.log(cronLine(entry));
    console.log("nothing was installed; put that line in your crontab yourself");
    return;
  }

  if (action === "remove") {
    if (typeof args.id !== "string") {
      return fail("schedule remove needs --id", 2);
    }
    const kept = entries.filter((entry) => entry.id !== args.id);
    if (kept.length === entries.length) {
      return fail(`no schedule with id ${args.id}`);
    }
    await writeSchedules(kept);
    console.log(`removed ${args.id}`);
    return;
  }

  fail(`unknown schedule action "${action}"\n\n${USAGE}`, 2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (command === undefined || command === "help" || args.help) {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "plan":
      return commandPlan(args);
    case "batch":
      return commandBatch(args);
    case "run":
      return commandRun(args);
    case "status":
      return commandStatus(args);
    case "schedule":
      return commandSchedule(args);
    default:
      return fail(`unknown command "${command}"\n\n${USAGE}`, 2);
  }
}

main().catch((cause) => {
  fail(cause instanceof Error ? cause.message : String(cause));
});
