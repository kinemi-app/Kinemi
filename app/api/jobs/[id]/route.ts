import { NextResponse } from "next/server";
import { comfyGeneratorFromEnv } from "../../../../lib/generate/comfy";
import { demoGenerator } from "../../../../lib/generate/demo";
import { getJob } from "../../../../lib/generate/store";

/**
 * Job status. Demo jobs derive their progress from elapsed time in the store, so this route is
 * cheap to poll. Comfy jobs ask the remote run.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }

  if (job.status === "succeeded" || job.status === "failed") {
    return NextResponse.json(job);
  }

  const generator = comfyGeneratorFromEnv() ?? demoGenerator;
  return NextResponse.json(await generator.poll(job));
}
