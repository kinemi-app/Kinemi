import { NextResponse } from "next/server";
import { comfySettings, generationMode } from "../../../lib/config/runtime";
import { comfyGeneratorFromEnv } from "../../../lib/generate/comfy";
import { demoGenerator } from "../../../lib/generate/demo";
import { readRequest } from "../../../lib/generate/request";

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

  const mode = generationMode();
  if (mode === "cloud" && comfySettings() === undefined) {
    return NextResponse.json({ error: "GENERATION_MODE=cloud needs COMFY_URL" }, { status: 503 });
  }

  const generator =
    mode === "local" ? demoGenerator : (comfyGeneratorFromEnv() ?? demoGenerator);
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
