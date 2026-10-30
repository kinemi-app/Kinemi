import { NextResponse } from "next/server";
import { checkDeployment } from "../../../../lib/generate/deploy";

async function check() {
  try {
    return NextResponse.json(await checkDeployment());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "the deployment check failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Both verbs are accepted so a browser or a curl can ask for the same report. */
export async function GET() {
  return check();
}

export async function POST() {
  return check();
}
