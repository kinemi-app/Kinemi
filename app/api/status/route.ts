import { NextResponse } from "next/server";
import { statusSnapshot } from "../../../lib/config/runtime";

export const dynamic = "force-dynamic";

/** What this process is configured to run against, without any secret value. */
export function GET() {
  return NextResponse.json(statusSnapshot(), {
    headers: { "cache-control": "no-store" },
  });
}
