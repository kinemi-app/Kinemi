/**
 * Install checker: `scripts/comfy-install.mjs` may only name verified, pinned downloads, must account
 * for every model file the local graphs load, and must surface what it could not verify. The tests
 * read `data/model-sources.json` and the graph sources themselves, so a guessed URL or a file that
 * falls through fails here. `--check` and `--print` never touch the network; the "complete" tree is
 * made of sparse files because the weights are up to 42 GB.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { MANIFEST, UNRESOLVED, nodeRow, weightRow } from "../scripts/comfy-install.mjs";

const SCRIPT = join(process.cwd(), "scripts", "comfy-install.mjs");
const SOURCES_PATH = join(process.cwd(), "data", "model-sources.json");
const WORKFLOWS_DIR = join(process.cwd(), "lib", "generate", "workflows");
const TIMEOUT_MS = 15000;

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HF_URL = /^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[0-9a-f]{40}\/\S+$/;
const GITHUB_RELEASE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/[\w.-]+\/[\w.-]+$/;
const GATED_AUTH_HEADER = '-H "Authorization: Bearer $HF_TOKEN"';
const HF_TOKEN_LINE = "HF_TOKEN is not set: gated weights will fail to download";
const URL_IN_COMMAND = /https?:\/\/[^\s'"]+/g;
const MODEL_FILE_LITERAL = /"[\w.-]+\.(?:safetensors|pth|ckpt|gguf|pt|onnx)"/g;
const URL_LITERAL = /https?:\/\/\S*/g;
const TOKEN_VALUE = "test-token-value";
/** Stand-ins for curl and git that print the command name and each argument, NUL-terminated, so the test sees how `sh` split the line. */
const ARGUMENT_PRINTERS = "curl() { printf 'curl\\0'; printf '%s\\0' \"$@\"; }; git() { printf 'git\\0'; printf '%s\\0' \"$@\"; }; ";

const sources = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
const weightByUrl = new Map(sources.weights.map((weight) => [weight.url, weight]));
const nodeByRepo = new Map(sources.nodes.map((node) => [node.repo, node]));

let workdir = "";

/** Run the checker with a fixed timeout; resolves with the exit code and both streams. `env` replaces the child's environment. */
function run(args, env = process.env) {
  return new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...args], { timeout: TIMEOUT_MS, env }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      done({ code, stdout, stderr });
    });
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Runs `command` in `sh` with curl and git replaced by argument printers; resolves with the arguments each call received. */
function shellArguments(command) {
  return new Promise((done, fail) => {
    const env = { ...process.env, HF_TOKEN: TOKEN_VALUE };
    execFile("sh", ["-c", ARGUMENT_PRINTERS + command], { timeout: TIMEOUT_MS, env }, (error, stdout) => {
      if (error === null) {
        done(stdout.split("\0").slice(0, -1));
      } else {
        fail(error);
      }
    });
  });
}

/** Every model-file name the graphs under lib/generate/workflows load, as a literal. */
async function graphModelFiles() {
  const names = new Set();
  for (const entry of await readdir(WORKFLOWS_DIR, { recursive: true })) {
    if (!entry.endsWith(".ts")) {
      continue;
    }
    const text = await readFile(join(WORKFLOWS_DIR, entry), "utf8");
    for (const literal of text.match(MODEL_FILE_LITERAL) ?? []) {
      names.add(literal.slice(1, -1));
    }
  }
  return names;
}

/** Make `target` a sparse file of `bytes` without writing any data. */
async function createSparseFile(target, bytes) {
  await mkdir(dirname(target), { recursive: true });
  const handle = await open(target, "w");
  try {
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
}

/** Create every manifest entry under `root`: a folder for nodes, a sparse file of the pinned size for weights. */
async function createCompleteTree(root) {
  for (const entry of MANIFEST) {
    const target = join(root, entry.path);
    if (entry.kind === "dir") {
      await mkdir(target, { recursive: true });
      continue;
    }
    await createSparseFile(target, entry.bytes);
  }
}

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), "kinemi-install-"));
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("every URL in a manifest command is a pinned, verified source and every row names its source", () => {
  assert.ok(MANIFEST.length > 0, "an empty manifest verifies nothing");
  assert.equal(MANIFEST.length, sources.nodes.length + sources.weights.length, "every sources entry is a row");
  assert.doesNotMatch(readFileSync(SOURCES_PATH, "utf8"), /\*/, "a masked hash (asterisks) must never be recorded");
  assert.ok(MANIFEST.some((row) => row.gated), "the manifest should hold a gated row for the gated checks to mean anything");

  for (const weight of sources.weights) {
    if (HF_URL.test(weight.url) && weight.gated === true) {
      assert.equal(weight.sha256, null, `${weight.file}: a gated file hides its hash, so sha256 is null and never a mask`);
    } else if (HF_URL.test(weight.url)) {
      assert.match(String(weight.sha256), SHA256, `${weight.file}: a Hugging Face file needs a 64-hex sha256`);
    } else {
      assert.match(weight.url, GITHUB_RELEASE_URL, `${weight.file}: ${weight.url} is neither a pinned HF nor a GitHub release URL`);
      assert.ok(weight.sha256 === null || SHA256.test(weight.sha256), `${weight.file}: sha256 is null or 64-hex`);
    }
    assert.ok(Number.isInteger(weight.bytes) && weight.bytes > 0, `${weight.file}: bytes is a positive integer`);
  }

  for (const row of MANIFEST) {
    assert.ok(typeof row.source === "string" && row.source !== "", `${row.id} has a source`);
    const urls = row.command.match(URL_IN_COMMAND) ?? [];
    assert.equal(urls.length, 1, `${row.id}: exactly one URL per command`);
    const [url] = urls;

    if (row.kind === "file") {
      const weight = weightByUrl.get(url);
      assert.ok(weight !== undefined, `${row.id}: ${url} is not a data/model-sources.json weights[].url`);
      assert.equal(weight.file, row.id, `${row.id}: the command downloads another weight's URL`);
      assert.equal(row.bytes, weight.bytes, `${row.id}: the row carries the pinned size`);
      assert.equal(row.gated, weight.gated === true, `${row.id}: the row carries the gated flag`);
      assert.equal(row.command.includes(GATED_AUTH_HEADER), row.gated, `${row.id}: only a gated command sends the literal Authorization header`);
      continue;
    }
    const node = nodeByRepo.get(url);
    assert.ok(node !== undefined, `${row.id}: ${url} is not a data/model-sources.json nodes[].repo`);
    assert.match(node.commit, COMMIT, `${row.id}: a node pack is pinned to a 40-hex commit`);
    assert.ok(row.command.endsWith(`checkout '${node.commit}'`), `${row.id}: the command checks out the pinned commit`);
  }
});

test("the script's own source names no URL: every address comes from data/model-sources.json", () => {
  const literals = readFileSync(SCRIPT, "utf8").match(URL_LITERAL) ?? [];
  assert.deepEqual(literals, [], "an http(s):// literal in comfy-install.mjs bypasses the verified list");
});

test("an odd file name stays one quoted argument and a gated header still expands $HF_TOKEN in the shell", async () => {
  const file = `odd name's $(echo pwn) "q".bin`;
  const url = "https://host.example/a b's/$(echo pwn).bin";
  const weight = { file, folder: "my folder", url, source: "x", bytes: 1 };

  const open = await shellArguments(weightRow(weight).command);
  assert.deepEqual(open, ["curl", "-L", "--fail", "--create-dirs", "-o", `models/my folder/${file}`, url]);

  const gated = await shellArguments(weightRow({ ...weight, gated: true }).command);
  assert.deepEqual(gated, ["curl", "-L", "--fail", "--create-dirs", "-H", `Authorization: Bearer ${TOKEN_VALUE}`, "-o", `models/my folder/${file}`, url]);
  assert.ok(!weightRow({ ...weight, gated: true }).command.includes(TOKEN_VALUE), "the command text holds the variable, never the token");

  const repo = "https://host.example/it's a repo";
  const commit = "abc'; echo pwn; '";
  const folder = "custom_nodes/odd pack's";
  const node = await shellArguments(nodeRow({ id: "odd pack's", repo, commit }).command);
  assert.deepEqual(node, ["git", "clone", repo, folder, "git", "-C", folder, "checkout", commit]);
});

test("every model file the graphs load is installed, auto-downloaded or listed as unresolved", async () => {
  const loaded = await graphModelFiles();
  assert.ok(loaded.size > 0, "the scan should find the graphs' model files");

  const installed = new Set(MANIFEST.filter((row) => row.kind === "file").map((row) => basename(row.path)));
  const unresolved = new Set(UNRESOLVED.filter((row) => row.what.startsWith("models/")).map((row) => basename(row.what)));
  const nodePacks = new Set(sources.nodes.map((node) => node.id));

  for (const auto of sources.autoDownloaded) {
    assert.ok(nodePacks.has(auto.nodePack), `${auto.file}: nodePack ${auto.nodePack} is not an installed pack`);
    assert.ok(typeof auto.why === "string" && auto.why !== "", `${auto.file}: says why the pack fetches it`);
  }
  const autoDownloaded = new Set(sources.autoDownloaded.map((auto) => auto.file));

  const fallenThrough = [...loaded].filter((name) => !installed.has(name) && !autoDownloaded.has(name) && !unresolved.has(name));
  assert.deepEqual(fallenThrough, [], "these graph files are in no manifest row, autoDownloaded entry or unresolved weight");
});

test("--print shows each unresolved row with its reason and marks each community row", async () => {
  const { code, stdout } = await run(["--print"]);
  assert.equal(code, 0, "--print needs no directory and always succeeds");
  const lines = stdout.split("\n");

  for (const item of UNRESOLVED) {
    assert.ok(lines.includes(`# unresolved: ${item.what}: ${item.reason}`), `--print should list ${item.what} with its reason`);
  }
  for (const auto of sources.autoDownloaded) {
    assert.ok(lines.includes(`# fetched by ${auto.nodePack} on first run: ${auto.file}`), `--print should mention ${auto.file}`);
  }
  assert.ok(MANIFEST.some((row) => row.community), "the manifest should hold a community row for this check to mean anything");
  for (const row of MANIFEST) {
    const at = lines.indexOf(row.command);
    assert.ok(at > 0, `--print should show the command for ${row.id}`);
    assert.equal(lines[at - 1] === `# community source: ${row.source}`, Boolean(row.community), `${row.id}: community marker`);
  }
});

test("--print puts the gated comment above each gated row", async () => {
  const { code, stdout } = await run(["--print"]);
  assert.equal(code, 0);
  const lines = stdout.split("\n");
  const gatedRows = MANIFEST.filter((row) => row.gated);
  assert.ok(gatedRows.length > 0, "the manifest should hold a gated row");
  for (const row of gatedRows) {
    const at = lines.indexOf(row.command);
    assert.ok(at > 0, `--print should show the command for ${row.id}`);
    assert.equal(lines[at - 1], `# gated: accept the licence at ${row.source} and set HF_TOKEN`, `${row.id}: gated comment`);
  }
  const comments = lines.filter((line) => line.startsWith("# gated:"));
  assert.equal(comments.length, gatedRows.length, "only gated rows get the comment");
});

test("--check warns when HF_TOKEN is unset and a gated row is missing, and stays quiet when it is set", async () => {
  const empty = join(workdir, "empty-token");
  await mkdir(empty);
  const withoutToken = { ...process.env };
  delete withoutToken.HF_TOKEN;

  const unset = await run(["--check", "--comfy-dir", empty], withoutToken);
  assert.equal(unset.code, 1);
  assert.ok(unset.stdout.split("\n").includes(HF_TOKEN_LINE), "--check should print the HF_TOKEN line");

  const set = await run(["--check", "--comfy-dir", empty], { ...withoutToken, HF_TOKEN: "set" });
  assert.ok(!set.stdout.includes(HF_TOKEN_LINE), "no warning once HF_TOKEN is set");
  assert.doesNotMatch(set.stdout, /Bearer/, "--check prints no Authorization header");
});

test("--apply without HF_TOKEN skips a missing gated weight, says why and exits non-zero", async () => {
  const tree = join(workdir, "apply-gated");
  await createCompleteTree(tree);
  const gated = MANIFEST.find((row) => row.gated);
  await rm(join(tree, gated.path));
  const withoutToken = { ...process.env };
  delete withoutToken.HF_TOKEN;

  const { code, stdout } = await run(["--apply", "--yes", "--comfy-dir", tree], withoutToken);
  assert.equal(code, 1, "a skipped gated weight leaves the install incomplete");
  const lines = stdout.split("\n");
  assert.ok(lines.includes(HF_TOKEN_LINE), "--apply should print the HF_TOKEN line");
  assert.ok(lines.includes(`skip ${gated.path} (gated: needs HF_TOKEN)`), "--apply should name the skipped row");
  assert.doesNotMatch(stdout, /^install /m, "nothing is downloaded without the token");
});

test("--check on an empty directory lists every row missing and the same unresolved lines", async () => {
  const empty = join(workdir, "empty");
  await mkdir(empty);

  const { code, stdout } = await run(["--check", "--comfy-dir", empty]);
  assert.equal(code, 1, "a missing tree is a failed check");
  for (const row of MANIFEST) {
    const marker = `${row.community === true ? " \\(community source\\)" : ""}${row.gated ? " \\(gated: needs HF_TOKEN\\)" : ""}`;
    assert.match(stdout, new RegExp(`^missing ${escapeRegExp(row.path)}${marker}$`, "m"), `${row.id} should print as missing`);
  }
  assert.match(stdout, new RegExp(`^${MANIFEST.length} of ${MANIFEST.length} entries missing$`, "m"));
  const lines = stdout.split("\n");
  for (const item of UNRESOLVED) {
    assert.ok(lines.includes(`unresolved ${item.what}: ${item.reason}`), `--check should list ${item.what} with its reason`);
  }
});

test("a complete sparse tree passes and a weight of the wrong size is reported", async () => {
  const full = join(workdir, "full");
  await createCompleteTree(full);

  const complete = await run(["--check", "--comfy-dir", full]);
  assert.equal(complete.code, 0, "every row present at its pinned size is a passing check");
  assert.match(complete.stdout, new RegExp(`^complete: all ${MANIFEST.length} entries present$`, "m"));
  assert.doesNotMatch(complete.stdout, /^(missing|wrong size) /m, "a complete tree prints no failing lines");

  const smallest = MANIFEST.filter((row) => row.kind === "file").sort((a, b) => a.bytes - b.bytes)[0];
  await createSparseFile(join(full, smallest.path), smallest.bytes - 1);
  const truncated = await run(["--check", "--comfy-dir", full]);
  assert.equal(truncated.code, 1, "a cut-off download fails the check");
  assert.match(truncated.stdout, new RegExp(`^wrong size ${escapeRegExp(smallest.path)}`, "m"));
  assert.match(truncated.stdout, new RegExp(`^1 of ${MANIFEST.length} entries missing$`, "m"));
});

test("neither the manifest commands nor the sources file mention kokoro", () => {
  for (const row of MANIFEST) {
    assert.doesNotMatch(row.command, /kokoro/i, `${row.id} command`);
  }
  assert.doesNotMatch(readFileSync(SOURCES_PATH, "utf8"), /kokoro/i, "data/model-sources.json");
});

test("bad arguments exit 2 before any check runs", async () => {
  const cases = [
    ["--bogus"],
    ["--check"],
    ["--check", "--comfy-dir"],
    ["--apply", "--comfy-dir", workdir],
    ["--check", "--print", "--comfy-dir", workdir],
  ];
  for (const args of cases) {
    const { code, stderr } = await run(args);
    assert.equal(code, 2, `"${args.join(" ")}" should be a usage error`);
    assert.match(stderr, /comfy-install:/, `"${args.join(" ")}" should say what went wrong`);
  }
});
