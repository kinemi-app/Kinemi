/**
 * F6 CLI run/status and scheduled notifications: `run` submits every shot in a plan and polls it,
 * `status` prints one job, and `schedule run-due --notify slack` posts a summary to a stub webhook.
 * A local node:http stub stands in for the app; a temp HOME keeps ~/.kinemi out of the real one.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const CLI = join(process.cwd(), "bin", "kinemi.mjs");
const TIMEOUT_MS = 30000;

const PLAN_SHOTS = [
  {
    index: 1,
    title: "Hook",
    mode: "cinematic",
    modelId: "wan22-t2v",
    prompt: "a hook shot",
    durationS: 2,
  },
  {
    index: 2,
    title: "Payoff",
    mode: "cinematic",
    modelId: "wan22-t2v",
    prompt: "a payoff shot",
    durationS: 2,
  },
];

let workdir = "";
let home = "";
let stub;
let base = "";

function respondJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** A stub app: records submissions and webhook calls, and answers each job from its prompt. */
async function startStub() {
  const submissions = [];
  const webhooks = [];

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString();
      const body = text === "" ? undefined : JSON.parse(text);

      if (request.method === "POST" && request.url === "/api/generate") {
        submissions.push(body);
        respondJson(response, 202, { jobId: `job-${submissions.length}` });
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/jobs/")) {
        const id = decodeURIComponent(request.url.slice("/api/jobs/".length));
        const submitted = submissions[Number(id.replace("job-", "")) - 1];
        if (submitted === undefined) {
          respondJson(response, 404, { error: "no such job" });
          return;
        }
        if (String(submitted.prompt).includes("fail")) {
          respondJson(response, 200, { status: "failed", error: "the model refused" });
          return;
        }
        respondJson(response, 200, {
          status: "succeeded",
          result: { url: `${base}/files/${id}.png` },
        });
        return;
      }

      if (request.method === "POST" && request.url === "/api/studio/plan") {
        respondJson(response, 200, { shots: PLAN_SHOTS });
        return;
      }

      if (request.method === "POST" && request.url === "/webhook") {
        webhooks.push(body);
        respondJson(response, 200, { ok: true });
        return;
      }

      respondJson(response, 404, { error: "not found" });
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;

  return {
    submissions,
    webhooks,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/** Run the CLI with an isolated HOME, so schedules land in the temp directory. */
function runCli(args, env = {}) {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        timeout: TIMEOUT_MS,
        env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        done({ code, stdout, stderr });
      },
    );
  });
}

async function writePlan(name, shots) {
  const path = join(workdir, name);
  await writeFile(path, `${JSON.stringify({ shots }, null, 2)}\n`);
  return path;
}

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), "kinemi-cli-"));
  home = join(workdir, "home");
  await mkdir(home, { recursive: true });
  stub = await startStub();
});

after(async () => {
  await stub?.stop();
  await rm(workdir, { recursive: true, force: true });
});

test("run submits every shot, polls it and exits 0", async () => {
  const plan = await writePlan("plan.json", PLAN_SHOTS);

  const { code, stdout } = await runCli(["run", plan, "--base", base]);
  assert.equal(code, 0, "two successful shots should exit 0");
  assert.equal(stub.submissions.length, 2, "run should post every shot");
  assert.equal(stub.submissions[0].mode, "cinematic");
  assert.equal(stub.submissions[0].prompt, "a hook shot");
  assert.match(stdout, /1\. Hook · succeeded · http:\/\/127\.0\.0\.1:\d+\/files\/job-1\.png/);
  assert.match(stdout, /2\. Payoff · succeeded · http:\/\/127\.0\.0\.1:\d+\/files\/job-2\.png/);
});

test("the public CLI has no parity command", async () => {
  const help = await runCli(["help"]);
  assert.equal(help.code, 0);
  assert.doesNotMatch(help.stdout, /parity/, "usage should not offer the local-only parity check");

  const { code, stderr } = await runCli(["parity"]);
  assert.equal(code, 2, "parity should be an unknown command");
  assert.match(stderr, /unknown command "parity"/);
});

test("run exits 1 when a shot fails", async () => {
  const plan = await writePlan("failing.json", [
    { index: 1, title: "Broken", mode: "cinematic", modelId: "wan22-t2v", prompt: "fail here", durationS: 2 },
  ]);

  const { code, stdout } = await runCli(["run", plan, "--base", base]);
  assert.equal(code, 1, "a failed shot should fail the command");
  assert.match(stdout, /1\. Broken · failed/);
});

test("status prints the job's state and result", async () => {
  const { code, stdout } = await runCli(["status", "job-1", "--base", base]);
  assert.equal(code, 0);
  assert.match(stdout, /^succeeded$/m);
  assert.match(stdout, /\/files\/job-1\.png/);

  const missing = await runCli(["status", "job-999", "--base", base]);
  assert.equal(missing.code, 1, "an unknown job should fail");
  assert.match(missing.stderr, /answered 404/);
});

test("plan still writes the shots the server returns", async () => {
  const out = join(workdir, "generated.json");
  const { code } = await runCli([
    "plan",
    "--brief",
    "a lighthouse in fog at dusk",
    "--out",
    out,
    "--base",
    base,
  ]);
  assert.equal(code, 0);
  const shots = JSON.parse(await readFile(out, "utf8"));
  assert.equal(shots.length, PLAN_SHOTS.length);
  assert.equal(shots[0].title, "Hook");
});

test("schedule run-due runs a due plan and notifies Slack", async () => {
  const plan = await writePlan("due.json", [PLAN_SHOTS[0]]);
  await mkdir(join(home, ".kinemi"), { recursive: true });
  await writeFile(
    join(home, ".kinemi", "schedules.json"),
    `${JSON.stringify(
      [{ id: "due-1", cron: "* * * * *", plan, base, name: "Daily" }],
      null,
      2,
    )}\n`,
  );

  const before = stub.submissions.length;
  const { code, stdout } = await runCli(
    ["schedule", "run-due", "--notify", "slack", "--base", base],
    { SLACK_WEBHOOK_URL: `${base}/webhook` },
  );
  assert.equal(code, 0, "a due plan and a configured webhook should exit 0");
  assert.equal(stub.submissions.length, before + 1, "the due plan should run through the batch path");
  assert.match(stdout, /schedule due-1 · Daily/);
  assert.match(stdout, /published slack/);
  assert.equal(stub.webhooks.length, 1, "the Slack webhook should receive one summary");
  assert.match(stub.webhooks[0].text, /Hook · succeeded/);
});
