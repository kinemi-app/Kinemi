/**
 * T-0052: regression proof for scripts/check-parity.mjs. Each failure case mutates a copy of the
 * two real tables and spawns the checker, so a mode the reviewer named cannot come back unnoticed.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECKER = join(PROJECT_ROOT, "scripts", "check-parity.mjs");
const TODO_PATH = join(PROJECT_ROOT, "TODO.md");
const SOURCE_PATH = join(PROJECT_ROOT, "docs", "higgsfield", "feature-parity.md");

const TODO_TEXT = await readFile(TODO_PATH, "utf8");
const SOURCE_TEXT = await readFile(SOURCE_PATH, "utf8");

const TOTALS = /(\d+)\s+beat,\s*(\d+)\s+match,\s*(\d+)\s+built,\s*(\d+)\s+planned,\s*(\d+)\s+skip/gi;

/** Run the checker on the repo's own files, or on two fixture files when text is given. */
async function runChecker({ todo, source } = {}) {
  if (todo === undefined) {
    return run([CHECKER]);
  }
  const directory = await mkdtemp(join(tmpdir(), "kinemi-parity-"));
  try {
    const todoPath = join(directory, "TODO.md");
    const sourcePath = join(directory, "feature-parity.md");
    await writeFile(todoPath, todo);
    await writeFile(sourcePath, source);
    return await run([CHECKER, todoPath, sourcePath]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Spawn the current node binary and collect its exit code and both streams. */
function run(args) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd: PROJECT_ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => accept({ code, stdout, stderr }));
  });
}

/** Rewrite one table row through its cells; the cell list starts at the id. */
function editRow(markdown, id, edit) {
  return markdown
    .split("\n")
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells[1] !== id) return line;
      return `| ${edit(cells.slice(1, -1)).join(" | ")} |`;
    })
    .join("\n");
}

function dropRow(markdown, id) {
  return markdown
    .split("\n")
    .filter((line) => line.split("|")[1]?.trim() !== id)
    .join("\n");
}

/** Replace one totals sentence by index, leaving every other occurrence untouched. */
function editTotals(markdown, index, replacement) {
  let seen = 0;
  return markdown.replace(TOTALS, (match) => {
    const current = seen;
    seen += 1;
    return current === index ? replacement : match;
  });
}

test("passes on the repo's own tables", async () => {
  const result = await runChecker();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /65\/65 rows match \(12 beat, 15 match, 26 built, 0 planned, 12 skip\)/);
});

test("fails when a row is dropped", async () => {
  const result = await runChecker({ todo: dropRow(TODO_TEXT, "V9"), source: SOURCE_TEXT });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /V9 is in the source table but missing from TODO\.md/);
});

test("fails when a verdict is changed", async () => {
  const todo = editRow(TODO_TEXT, "V1", (cells) => {
    cells[2] = "Match";
    return cells;
  });
  const result = await runChecker({ todo, source: SOURCE_TEXT });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /V1 says Match in TODO\.md and Beat in the source table/);
});

test("fails when the table gains a row the source does not have", async () => {
  const result = await runChecker({
    todo: `${TODO_TEXT}\n| Z9 | Unresearched feature | Beat | P0 | Nothing. | — |\n`,
    source: SOURCE_TEXT,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Z9 is in TODO\.md but not in the source table/);
});

test("fails when a later totals sentence goes stale", async () => {
  const result = await runChecker({
    todo: editTotals(TODO_TEXT, 1, "12 beat, 16 match, 25 built, 0 planned, 12 skip"),
    source: SOURCE_TEXT,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /TODO\.md states 12 beat, 16 match, 25 built, 0 planned, 12 skip/);
});

test("fails when no totals sentence is left, with the source's own counts", async () => {
  const result = await runChecker({
    todo: TODO_TEXT.replace(TOTALS, "the totals"),
    source: dropRow(SOURCE_TEXT, "V9"),
  });
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /no longer states its verdict totals \(expected "12 beat, 14 match, 26 built, 0 planned, 12 skip"\)/,
  );
});

test("reads the verdict from the verdict column, not the feature text", async () => {
  const todo = editRow(TODO_TEXT, "V3", (cells) => {
    // Exactly a verdict word, so the old "first verdict token after the id" would read it.
    cells[1] = "Beat";
    return cells;
  });
  const result = await runChecker({ todo, source: SOURCE_TEXT });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /12 beat, 15 match, 26 built, 0 planned, 12 skip/);
});
