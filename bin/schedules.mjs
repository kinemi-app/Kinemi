/**
 * Schedule storage and the five-field cron matcher behind `kinemi schedule`. Split out of
 * bin/kinemi.mjs so the command file stays under the project's size limit; the behaviour is the
 * same and tests/cli.backend.mjs exercises it through the CLI.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = join(homedir(), ".kinemi");
export const SCHEDULES = join(HOME, "schedules.json");
export const CRON_FIELDS = 5;

const CRON_LIMITS = [59, 23, 31, 12, 6];

/** One cron field against one local value: `*`, a number, a list, a range, or a `/step`. */
function cronMatches(field, limit, value) {
  if (typeof field !== "string" || field === "") {
    return false;
  }
  return field.split(",").some((part) => {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step <= 0) {
      return false;
    }
    let start;
    let end;
    if (range === "*") {
      start = 0;
      end = limit;
    } else if (range.includes("-")) {
      [start, end] = range.split("-").map(Number);
    } else {
      start = Number(range);
      end = start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return false;
    }
    return value >= start && value <= end && (value - start) % step === 0;
  });
}

/** Whether an entry's five-field cron names the current local minute. */
export function isDue(entry, now) {
  if (typeof entry.cron !== "string") {
    return false;
  }
  const fields = entry.cron.trim().split(/\s+/);
  if (fields.length !== CRON_FIELDS) {
    return false;
  }
  const values = [now.getMinutes(), now.getHours(), now.getDate(), now.getMonth() + 1, now.getDay()];
  return fields.every((field, index) => cronMatches(field, CRON_LIMITS[index], values[index]));
}

export async function readSchedules() {
  let raw;
  try {
    raw = await readFile(SCHEDULES, "utf8");
  } catch (cause) {
    if (cause instanceof Error && cause.code === "ENOENT") {
      return [];
    }
    throw new Error(`cannot read ${SCHEDULES}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${SCHEDULES} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!Array.isArray(entries)) {
    throw new Error(`${SCHEDULES} does not hold a list of schedules`);
  }
  return entries;
}

export async function writeSchedules(entries) {
  await mkdir(HOME, { recursive: true });
  await writeFile(SCHEDULES, `${JSON.stringify(entries, null, 2)}\n`);
}
