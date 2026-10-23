/** Where one shot in a storyboard stands: waiting, rendering, or finished. */
export type ShotStatus = "idle" | "running" | "succeeded" | "failed";

/** One shot in a storyboard: its own prompt, model and duration, plus the render state. */
export type Shot = {
  id: string;
  prompt: string;
  modelId: string;
  durationS: number;
  status: ShotStatus;
  progress?: number;
  resultUrl?: string;
  error?: string;
};

/** The most shots a storyboard may hold; the flow enforces this before it calls the queue. */
export const MAX_SHOTS = 8;

let fallbackSequence = 0;

/** randomUUID needs a secure context; the fallback only has to be unique inside one board. */
function createShotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackSequence += 1;
  return `shot-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}

/** A blank shot waiting for a prompt; the flow fills in the prompt and the render state. */
export function newShot(modelId: string, durationS: number): Shot {
  return {
    id: createShotId(),
    prompt: "",
    modelId,
    durationS,
    status: "idle",
  };
}
