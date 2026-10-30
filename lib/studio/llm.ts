import { llmSettings } from "../config/llm";
import { defaultModelForMode, findModel, MODES } from "../models";
import type { Mode } from "../types";

/**
 * The planner's language-model path. It asks for strict JSON, then validates every shot against
 * the same registry the batch runner uses. Anything short of a complete, valid plan is a throw;
 * the planner falls back to its template rather than sending a malformed shot to a generator.
 */

export type PlannedShot = {
  index: number;
  title: string;
  prompt: string;
  mode: Mode;
  durationS: number;
  modelId: string;
};

const MIN_SHOTS = 4;
const MAX_SHOTS = 8;
const MAX_TITLE = 80;
const MAX_PROMPT = 600;
const TEMPERATURE = 0.4;
const REQUEST_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = [
  "You plan short product films for Kinemi, a ComfyUI film studio.",
  `Answer with JSON only: {"shots":[{"title":"...","prompt":"...","mode":"...","durationS":1}]}.`,
  `Return ${MIN_SHOTS} to ${MAX_SHOTS} shots in story order.`,
  `"mode" must be one of: ${MODES.join(", ")}.`,
  `"title" is at most ${MAX_TITLE} characters; "prompt" at most ${MAX_PROMPT}.`,
  `"durationS" is a positive number that fits the mode.`,
  'Omit "modelId" to use the mode\'s default model.',
].join(" ");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(row: Record<string, unknown>, key: string, max: number): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`the planner LLM's "${key}" must be a string`);
  }
  const text = value.trim();
  if (text === "" || text.length > max) {
    throw new Error(`the planner LLM's "${key}" must be 1-${max} characters`);
  }
  return text;
}

function readMode(value: unknown): Mode {
  if (typeof value !== "string" || !MODES.includes(value as Mode)) {
    throw new Error(`the planner LLM returned an unknown mode`);
  }
  return value as Mode;
}

function readModel(
  row: Record<string, unknown>,
  mode: Mode,
): { id: string; maxDurationS: number } {
  const fallback = defaultModelForMode(mode);
  if (row.modelId === undefined) {
    return { id: fallback.id, maxDurationS: fallback.maxDurationS };
  }
  if (typeof row.modelId !== "string") {
    throw new Error(`the planner LLM's "modelId" must be a string`);
  }
  const model = findModel(row.modelId);
  if (model === undefined || !model.modes.includes(mode)) {
    throw new Error(`the planner LLM picked a model that does not serve "${mode}"`);
  }
  return { id: model.id, maxDurationS: model.maxDurationS };
}

function readShot(row: unknown, index: number): PlannedShot {
  if (!isRecord(row)) {
    throw new Error("the planner LLM returned a shot that is not an object");
  }

  const title = readText(row, "title", MAX_TITLE);
  const prompt = readText(row, "prompt", MAX_PROMPT);
  const mode = readMode(row.mode);
  const model = readModel(row, mode);
  const cap = Math.min(defaultModelForMode(mode).maxDurationS, model.maxDurationS);
  const durationS = row.durationS;
  if (typeof durationS !== "number" || !Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`the planner LLM's "durationS" must be a positive number`);
  }
  if (durationS > cap) {
    throw new Error(`the planner LLM's "durationS" is longer than "${mode}" allows`);
  }

  return { index, title, prompt, mode, modelId: model.id, durationS };
}

function readContent(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) {
    throw new Error("the planner LLM answered without choices");
  }
  const choice = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    throw new Error("the planner LLM answered without message content");
  }
  return choice.message.content;
}

function readShots(parsed: unknown): PlannedShot[] {
  let rows: unknown[];
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (isRecord(parsed) && Array.isArray(parsed.shots)) {
    rows = parsed.shots;
  } else {
    throw new Error("the planner LLM's JSON is not a shot list");
  }

  if (rows.length < MIN_SHOTS || rows.length > MAX_SHOTS) {
    throw new Error(`the planner LLM must return ${MIN_SHOTS}-${MAX_SHOTS} shots`);
  }
  return rows.map((row, index) => readShot(row, index + 1));
}

export function llmConfigured(): boolean {
  return llmSettings() !== undefined;
}

export async function planWithLlm(brief: string): Promise<PlannedShot[]> {
  const settings = llmSettings();
  if (settings === undefined) {
    throw new Error("the planner LLM is not configured");
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiKey !== "") {
    headers.authorization = `Bearer ${settings.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(`${settings.url}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: brief },
        ],
        response_format: { type: "json_object" },
        temperature: TEMPERATURE,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("the planner LLM could not be reached");
  }

  if (!response.ok) {
    throw new Error(`the planner LLM refused the request: HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("the planner LLM answered without JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readContent(body));
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      throw new Error("the planner LLM's message content is not JSON");
    }
    throw cause;
  }

  return readShots(parsed);
}
