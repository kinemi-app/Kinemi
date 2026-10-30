/**
 * B1 contract: the dotenv parser and loader the launcher uses. `loadEnvFile` may fill
 * `process.env`, so every test restores the variables it touches.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadEnvFile, parseEnv } from "../scripts/env.mjs";

const ENV_TEXT = [
  "# a comment line",
  "",
  "PLAIN=value",
  "export EXPORTED=also-value",
  'SINGLE=one pair of spaces',
  'DOUBLE="two words"',
  "EMPTY=",
  "  SPACED  =  padded  ",
  "NOT AN ASSIGNMENT",
  "=missing-key",
  "1LEADING=ignored",
  "TRAILING_QUOTE='half",
].join("\n");

test("parseEnv reads assignments, comments, export and quotes", () => {
  assert.deepEqual(parseEnv(ENV_TEXT), {
    PLAIN: "value",
    EXPORTED: "also-value",
    SINGLE: "one pair of spaces",
    DOUBLE: "two words",
    EMPTY: "",
    SPACED: "padded",
    TRAILING_QUOTE: "'half",
  });
});

test("loadEnvFile fills only variables that are not set yet", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinemi-env-"));
  const path = join(directory, ".env");
  await writeFile(path, ["EXISTING=from-file", "FRESH=from-file", "EMPTY="].join("\n"));

  const before = process.env.EXISTING;
  const beforeFresh = process.env.FRESH;
  process.env.EXISTING = "from-process";
  delete process.env.FRESH;
  try {
    const loaded = await loadEnvFile(path);
    assert.deepEqual(loaded, { EXISTING: "from-file", FRESH: "from-file", EMPTY: "" });
    assert.equal(process.env.EXISTING, "from-process", "a set variable must win");
    assert.equal(process.env.FRESH, "from-file", "an unset variable is filled");
    assert.equal(process.env.EMPTY, "", "an empty value is still set");
  } finally {
    if (before === undefined) {
      delete process.env.EXISTING;
    } else {
      process.env.EXISTING = before;
    }
    if (beforeFresh === undefined) {
      delete process.env.FRESH;
    } else {
      process.env.FRESH = beforeFresh;
    }
    delete process.env.EMPTY;
  }
});

test("loadEnvFile treats a missing file as an empty configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinemi-env-"));
  assert.deepEqual(await loadEnvFile(join(directory, "absent.env")), {});
});
