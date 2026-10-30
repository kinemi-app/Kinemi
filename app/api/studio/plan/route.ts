import { NextResponse } from "next/server";
import { MAX_BRIEF, MIN_BRIEF, normalizeBrief, planShots } from "../../../../lib/studio/planner";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const { brief } = body as Record<string, unknown>;
  if (typeof brief !== "string" || brief.trim().length < MIN_BRIEF) {
    return NextResponse.json(
      { error: `"brief" must be a string of at least ${MIN_BRIEF} characters` },
      { status: 400 },
    );
  }
  if (brief.length > MAX_BRIEF) {
    return NextResponse.json({ error: `"brief" must be at most ${MAX_BRIEF} characters` }, { status: 400 });
  }
  if (normalizeBrief(brief) === "") {
    return NextResponse.json({ error: `"brief" must carry a subject` }, { status: 400 });
  }

  return NextResponse.json(await planShots(brief));
}
