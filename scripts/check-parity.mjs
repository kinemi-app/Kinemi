#!/usr/bin/env node
/**
 * Cross-check for the parity map. `TODO.md` summarises the 65 rows of
 * `docs/higgsfield/feature-parity.md`, and nothing else in the repo proves that summary still
 * matches the source or that its stated totals are right. Exits 1 with the difference, so it can
 * be the last step of any doc change.
 */
import console from "node:console";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const VERDICTS = new Set(["Beat", "Match", "Built", "Planned", "Skip"]);
const [todoArg, sourceArg] = process.argv.slice(2);
const TODO_PATH = todoArg ? resolve(todoArg) : new URL("../TODO.md", import.meta.url);
const SOURCE_PATH = sourceArg
  ? resolve(sourceArg)
  : new URL("../docs/higgsfield/feature-parity.md", import.meta.url);
const STATED_TOTALS =
  /(\d+)\s+beat,\s*(\d+)\s+match,\s*(\d+)\s+built,\s*(\d+)\s+planned,\s*(\d+)\s+skip/gi;

/** Every table row that opens with a parity id, as id -> verdict, from the verdict column only. */
function readRows(markdown) {
  const rows = new Map();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const id = cells[1] ?? "";
    if (!/^[A-Z]\d{1,3}$/.test(id)) continue;
    const verdict = cells[3];
    if (VERDICTS.has(verdict) && !rows.has(id)) {
      rows.set(id, verdict);
    }
  }
  return rows;
}

/** Every totals sentence in the document, so a stale second one cannot hide behind a fresh first. */
function readStatedTotals(markdown) {
  return [...markdown.matchAll(STATED_TOTALS)].map((match) => ({
    beat: Number(match[1]),
    match: Number(match[2]),
    built: Number(match[3]),
    planned: Number(match[4]),
    skip: Number(match[5]),
  }));
}

function countVerdicts(rows) {
  const counts = { beat: 0, match: 0, built: 0, planned: 0, skip: 0 };
  for (const verdict of rows.values()) {
    counts[verdict.toLowerCase()] += 1;
  }
  return counts;
}

function sameCounts(left, right) {
  return (
    left.beat === right.beat &&
    left.match === right.match &&
    left.built === right.built &&
    left.planned === right.planned &&
    left.skip === right.skip
  );
}

function describe(counts) {
  return `${counts.beat} beat, ${counts.match} match, ${counts.built} built, ${counts.planned} planned, ${counts.skip} skip`;
}

const [todo, source] = await Promise.all([
  readFile(TODO_PATH, "utf8"),
  readFile(SOURCE_PATH, "utf8"),
]);

const summary = readRows(todo);
const reference = readRows(source);
const problems = [];

for (const [id, verdict] of reference) {
  if (!summary.has(id)) {
    problems.push(`${id} is in the source table but missing from TODO.md`);
  } else if (summary.get(id) !== verdict) {
    problems.push(`${id} says ${summary.get(id)} in TODO.md and ${verdict} in the source table`);
  }
}
for (const id of summary.keys()) {
  if (!reference.has(id)) {
    problems.push(`${id} is in TODO.md but not in the source table`);
  }
}

const summaryCounts = countVerdicts(summary);
const referenceCounts = countVerdicts(reference);
if (!sameCounts(summaryCounts, referenceCounts)) {
  problems.push(
    `verdict totals differ: TODO.md ${describe(summaryCounts)}, source ${describe(referenceCounts)}`,
  );
}

const stated = readStatedTotals(todo);
if (stated.length === 0) {
  problems.push(
    `TODO.md no longer states its verdict totals (expected "${describe(referenceCounts)}")`,
  );
}
for (const counts of stated) {
  if (!sameCounts(counts, summaryCounts)) {
    problems.push(`TODO.md states ${describe(counts)} but its table holds ${describe(summaryCounts)}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  console.error(`${summary.size} rows in TODO.md, ${reference.size} in the source table`);
  process.exitCode = 1;
} else {
  console.log(`${summary.size}/${reference.size} rows match (${describe(summaryCounts)})`);
}
