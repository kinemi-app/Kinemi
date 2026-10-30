import { NextResponse } from "next/server";
import { defaultModelForMode, MODES, models } from "../../../lib/models";

/** The model registry the studio may ask for, and the model each mode falls back to. */
export function GET() {
  return NextResponse.json({
    models: models.map(({ id, name, vendor, kind, modes, maxDurationS }) => ({
      id,
      name,
      vendor,
      kind,
      modes,
      maxDurationS,
    })),
    defaults: Object.fromEntries(MODES.map((mode) => [mode, defaultModelForMode(mode).id])),
  });
}
