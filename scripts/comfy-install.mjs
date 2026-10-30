#!/usr/bin/env node
/**
 * Install checker for a self-hosted ComfyUI. `--check` compares the manifest below against a
 * ComfyUI directory without touching the network, `--print` writes the commands to install what
 * the graphs need, and `--apply --yes` is the only mode that clones or downloads.
 *
 * Every row comes from `data/model-sources.json`, the verified list: weights are pinned downloads
 * with a known size, nodes are cloned and checked out at a pinned commit. Whatever could not be
 * verified is listed in UNRESOLVED and is never downloaded. Refresh the list with
 * `node scripts/verify-model-sources.mjs`.
 */
import { spawn } from "node:child_process";
import console from "node:console";
import { readFileSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = `Usage: node scripts/comfy-install.mjs [--check | --print | --apply] [--comfy-dir <path>] [--yes]
  --check      report every manifest entry missing under <path> (default)
  --print      print the git clone and download commands, run nothing
  --apply      run the commands; needs --comfy-dir and --yes
Both --check and --apply need --comfy-dir; --print needs neither.`;

const SOURCES = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/model-sources.json", import.meta.url)), "utf8"),
);

/** Single-quotes a value for `sh`; an embedded single quote becomes '\'' so nothing in it is interpreted. */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function nodeRow({ id, repo, commit }) {
  const folder = shellQuote(`custom_nodes/${id}`);
  return {
    id,
    kind: "dir",
    path: `custom_nodes/${id}`,
    source: repo,
    command: `git clone ${shellQuote(repo)} ${folder} && git -C ${folder} checkout ${shellQuote(commit)}`,
  };
}

/** The shell expands $HF_TOKEN when the command runs; this script never reads or prints the token. */
const GATED_AUTH_HEADER = '-H "Authorization: Bearer $HF_TOKEN"';
const HF_TOKEN_MISSING = "HF_TOKEN is not set: gated weights will fail to download";

const hasToken = () => (process.env.HF_TOKEN ?? "") !== "";

export function weightRow({ file, folder, url, source, bytes, sha256, community, gated }) {
  const auth = gated ? ` ${GATED_AUTH_HEADER}` : "";
  return {
    id: file,
    kind: "file",
    path: `models/${folder}/${file}`,
    source,
    bytes,
    sha256,
    community: Boolean(community),
    gated: Boolean(gated),
    command: `curl -L --fail --create-dirs${auth} -o ${shellQuote(`models/${folder}/${file}`)} ${shellQuote(url)}`,
  };
}

function unresolvedRow(miss) {
  const what = miss.kind === "weight" ? `models/${miss.folder}/${miss.file}` : `node class ${miss.class}`;
  return { what, reason: miss.reason ?? `not found in ${miss.tried.join(", ")}` };
}

/**
 * What the graphs in `lib/generate/workflows/**` load, from the verified list. Node rows are folders
 * under `custom_nodes/`, weight rows are files under `models/<folder>/`. Commands run from the
 * ComfyUI directory and never embed it, so `--print` needs no `--comfy-dir`.
 */
export const MANIFEST = [...SOURCES.nodes.map(nodeRow), ...SOURCES.weights.map(weightRow)];

/** What could not be verified: printed by `--check` and `--print`, never installed. */
export const UNRESOLVED = SOURCES.misses.map(unresolvedRow);

/** Files a node pack fetches itself on first run; `--print` mentions them, nothing downloads them. */
const AUTO_DOWNLOADED = SOURCES.autoDownloaded;

/** A bad argument; the caller reports it and exits 2 rather than treating it as a check result. */
class UsageError extends Error {}

/** True when a manifest path exists; permission and other errors propagate instead of reading as missing. */
async function isPresent(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Compares one manifest row with the ComfyUI directory: a folder only has to exist, a file must
 * also have the pinned size, so a cut-off download reads as `wrong size` and not as `ok`.
 */
export async function inspect(entry, comfyDir) {
  const target = resolve(comfyDir, entry.path);
  if (entry.kind === "dir") {
    return (await isPresent(target)) ? "ok" : "missing";
  }
  try {
    const { size } = await stat(target);
    return size === entry.bytes ? "ok" : "wrong size";
  } catch (error) {
    if (error.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

/** Prints one line per row and per unresolved item, and returns how many rows are not ok. */
async function checkManifest(comfyDir) {
  let notOk = 0;
  let isGatedNotOk = false;

  for (const entry of MANIFEST) {
    const status = await inspect(entry, comfyDir);
    if (status !== "ok") {
      notOk += 1;
      isGatedNotOk ||= entry.gated;
    }
    console.log(`${status} ${entry.path}${entry.community ? " (community source)" : ""}${entry.gated ? " (gated: needs HF_TOKEN)" : ""}`);
  }

  if (notOk === 0) {
    console.log(`complete: all ${MANIFEST.length} entries present`);
  } else {
    console.log(`${notOk} of ${MANIFEST.length} entries missing`);
  }
  if (isGatedNotOk && !hasToken()) {
    console.log(HF_TOKEN_MISSING);
  }
  for (const item of UNRESOLVED) {
    console.log(`unresolved ${item.what}: ${item.reason}`);
  }
  return notOk;
}

/** Prints the commands as shell lines; comments mark what is community-hosted or not installed. */
function printManifest() {
  console.log("# Run these from the ComfyUI directory. --print executes nothing and needs no --comfy-dir.");
  for (const entry of MANIFEST) {
    if (entry.community) {
      console.log(`# community source: ${entry.source}`);
    }
    if (entry.gated) {
      console.log(`# gated: accept the licence at ${entry.source} and set HF_TOKEN`);
    }
    console.log(entry.command);
  }
  for (const item of AUTO_DOWNLOADED) {
    console.log(`# fetched by ${item.nodePack} on first run: ${item.file}`);
  }
  for (const item of UNRESOLVED) {
    console.log(`# unresolved: ${item.what}: ${item.reason}`);
  }
}

/** Runs one manifest command from the ComfyUI directory; the commands are literals, never input. */
function runCommand(command, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, { cwd, shell: true, stdio: "inherit" });
    child.on("error", (error) => {
      console.error(`could not run "${command}": ${error.message}`);
      resolvePromise(1);
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

/** Installs the rows that are not ok in order, stopping at the first failure, then checks the result. */
async function applyManifest(comfyDir) {
  let hasSkippedGated = false;
  for (const entry of MANIFEST) {
    const status = await inspect(entry, comfyDir);
    if (status === "ok") {
      continue;
    }
    if (entry.gated && !hasToken()) {
      console.log(`skip ${entry.path} (gated: needs HF_TOKEN)`);
      hasSkippedGated = true;
      continue;
    }
    console.log(`install ${entry.path} (${status})`);
    const code = await runCommand(entry.command, comfyDir);
    if (code !== 0) {
      console.error(`install failed for ${entry.id} (exit ${code}); stopping`);
      if (hasSkippedGated) {
        console.log(HF_TOKEN_MISSING);
      }
      process.exitCode = 1;
      return;
    }
  }

  const missing = await checkManifest(comfyDir);
  process.exitCode = missing === 0 ? 0 : 1;
}

/** Parses the flags once; a mode other than --print needs a directory and --apply needs --yes. */
function parseArgs(argv) {
  const MODE_FLAGS = { "--check": "check", "--print": "print", "--apply": "apply" };
  const modes = new Set();
  let comfyDir = "";
  let yes = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const mode = MODE_FLAGS[arg];
    if (mode !== undefined) {
      modes.add(mode);
      continue;
    }
    if (arg === "--yes") {
      yes = true;
      continue;
    }
    if (arg === "--comfy-dir") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError("--comfy-dir needs a path");
      }
      comfyDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--comfy-dir=")) {
      comfyDir = arg.slice("--comfy-dir=".length);
      if (comfyDir === "") {
        throw new UsageError("--comfy-dir needs a path");
      }
      continue;
    }
    throw new UsageError(`unknown argument "${arg}"`);
  }

  if (modes.size > 1) {
    throw new UsageError("choose one of --check, --print and --apply");
  }
  const mode = [...modes][0] ?? "check";
  if (mode !== "print" && comfyDir === "") {
    throw new UsageError(`--${mode} needs --comfy-dir <path>`);
  }
  if (mode === "apply" && !yes) {
    throw new UsageError("--apply needs --yes; it clones and downloads");
  }
  return { mode, comfyDir };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) {
      throw error;
    }
    console.error(`comfy-install: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  if (options.mode === "print") {
    printManifest();
    return;
  }
  if (options.mode === "check") {
    process.exitCode = (await checkManifest(options.comfyDir)) === 0 ? 0 : 1;
    return;
  }
  await applyManifest(options.comfyDir);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
