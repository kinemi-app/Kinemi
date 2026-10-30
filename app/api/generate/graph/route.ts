import { NextResponse } from "next/server";
import { readRequest } from "../../../../lib/generate/request";
import { graphTargetFromEnv } from "../../../../lib/generate/comfy";
import { graphFor } from "../../../../lib/generate/workflows";

/**
 * The graph a request would send, without creating a job or calling ComfyUI. The studio uses it
 * to show what a deployment will be asked to run.
 */
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

  try {
    return NextResponse.json({ graph: graphFor(validated.request, graphTargetFromEnv()) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "the graph could not be built";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
