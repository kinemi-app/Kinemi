import { NextResponse } from "next/server";
import { comfyGeneratorFromEnv } from "../../../lib/generate/comfy";
import { demoGenerator } from "../../../lib/generate/demo";
import { findModel, MODES } from "../../../lib/models";
import type { GenerateRequest, Mode } from "../../../lib/types";

const MAX_PROMPT = 2000;

type Validated = { request: GenerateRequest } | { problem: string };

/** Only primitives travel in the params bag; anything else is a client bug and is refused. */
function readParams(raw: unknown): Record<string, string | number | boolean> | string {
  if (raw === undefined) {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return `"params" must be an object of strings, numbers or booleans`;
  }

  const params: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    const kind = typeof value;
    if (kind !== "string" && kind !== "number" && kind !== "boolean") {
      return `"params.${key}" must be a string, number or boolean`;
    }
    params[key] = value as string | number | boolean;
  }
  return params;
}

function readRequest(body: unknown): Validated {
  if (typeof body !== "object" || body === null) {
    return { problem: "body must be a JSON object" };
  }

  const { mode, modelId, prompt, durationS, seed, params } = body as Record<string, unknown>;

  if (typeof mode !== "string" || !MODES.includes(mode as Mode)) {
    return { problem: `"mode" must be one of ${MODES.join(", ")}` };
  }
  if (typeof modelId !== "string") {
    return { problem: `"modelId" must be a string` };
  }

  const model = findModel(modelId);
  if (!model) {
    return { problem: `unknown model "${modelId}"` };
  }
  if (!model.modes.includes(mode as Mode)) {
    return { problem: `model "${modelId}" does not serve mode "${mode}"` };
  }
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { problem: `"prompt" must be a non-empty string` };
  }
  if (prompt.length > MAX_PROMPT) {
    return { problem: `"prompt" must be at most ${MAX_PROMPT} characters` };
  }
  if (typeof durationS !== "number" || !Number.isFinite(durationS) || durationS <= 0) {
    return { problem: `"durationS" must be a positive number` };
  }
  if (durationS > model.maxDurationS) {
    return { problem: `"durationS" must be at most ${model.maxDurationS}s for ${model.name}` };
  }
  if (seed !== undefined && (typeof seed !== "number" || !Number.isFinite(seed))) {
    return { problem: `"seed" must be a number when given` };
  }

  const readParamsResult = readParams(params);
  if (typeof readParamsResult === "string") {
    return { problem: readParamsResult };
  }

  const request: GenerateRequest = {
    mode: mode as Mode,
    modelId,
    prompt,
    durationS,
    params: readParamsResult,
  };
  if (typeof seed === "number") {
    request.seed = seed;
  }

  return { request };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const validated = readRequest(body);
  if ("problem" in validated) {
    return NextResponse.json({ error: validated.problem }, { status: 400 });
  }

  const generator = comfyGeneratorFromEnv() ?? demoGenerator;
  try {
    const job = await generator.submit(validated.request);
    // Accepted either way: a run that fails immediately is a job whose status says so, which the
    // client already handles while polling. Only a thrown error (the upstream never answered)
    // has no job to hand back.
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "the run could not start";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
