/**
 * The agent's system prompt opens with agentIntro (web/src/app/chat/agent-prompt.ts): the agent's
 * name, its job, every tool it may use and the rule that a render waits for the user's approval.
 * llm.ts's systemPrompt starts with agentIntro(APP_TOOLS), so these checks read the text the model
 * gets, built from the same tool registry the studio lists. (Restored from checkpoint 2dba0ca9,
 * which checked llm.ts's source text instead of the prompt.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { agentIntro } from "../web/src/app/chat/agent-prompt.ts";
import { TOOLS } from "../web/src/data/tools.ts";

/** A tool's id is its icon, as in web/src/app/data/tools.ts. */
const tools = TOOLS.map((t) => ({ id: t.icon, name: t.name }));
const prompt = agentIntro(tools);

test("the registry holds the 16 tools the prompt promises", () => {
  assert.equal(tools.length, 16, `web/src/data/tools.ts lists ${tools.length} tools`);
  assert.match(prompt, /one of the 16 tools/, "the prompt counts the tools");
  assert.match(prompt, /any of the 16 tools, and only these:/, "the prompt allows exactly those tools");
});

test("the prompt names the agent and what it does", () => {
  assert.match(prompt, /^You are Kinemi, the assistant director of this studio\./);
  assert.match(prompt, /Your job: turn what the director says into one shot the studio can run\./);
  assert.match(prompt, /Renders run on the user's own ComfyUI with open models\./);
});

test("every tool is named in the prompt by its id and name", () => {
  for (const t of tools) assert.ok(prompt.includes(`${t.id} (${t.name})`), `${t.id} (${t.name}) is missing`);
});

test("the prompt says a render waits for the user's approval", () => {
  assert.match(prompt, /a render you ask for waits for the user to approve it/, "the approval rule is stated");
  assert.match(prompt, /unless they turned YOLO on in Settings/, "and its one exception is named");
  assert.match(prompt, /never say a render is running or finished/, "the model may not claim a run it did not see");
});

test("the system prompt the model gets starts with this opening", () => {
  const llm = readFileSync("web/src/app/chat/llm.ts", "utf8");
  assert.match(llm, /return `\$\{agentIntro\(APP_TOOLS\)\}\n/, "systemPrompt opens with agentIntro(APP_TOOLS)");
});
