import { defaultModelForMode } from "../models";
import type { Mode } from "../types";
import type { PlannedShot } from "./llm";

export type { PlannedShot };

export type PlanSource = "model" | "template";

export type PlanResult = {
  shots: PlannedShot[];
  source: PlanSource;
};

type ShotTemplate = {
  title: string;
  lead: string;
  mode: Mode;
  durationS: number;
};

/**
 * Six shots that fit a product campaign. Each duration is within its default model's cap for that
 * mode, so the plan can be submitted as it is.
 */
const TEMPLATE: ShotTemplate[] = [
  { title: "Hook", lead: "open on", mode: "ads", durationS: 3 },
  { title: "Product hero", lead: "clean product shot of", mode: "ads", durationS: 1 },
  { title: "Detail", lead: "close detail of", mode: "ads", durationS: 1 },
  { title: "In use", lead: "someone using", mode: "cinematic", durationS: 4 },
  { title: "Proof", lead: "before and after with", mode: "ads", durationS: 3 },
  { title: "Call to action", lead: "end card for", mode: "ads", durationS: 3 },
];

const MAX_SUBJECT = 120;

/**
 * The brief as the prompts carry it: one line, no trailing punctuation, capped at MAX_SUBJECT.
 * Callers validate this subject, since a brief of punctuation alone leaves nothing to plan around.
 */
export function normalizeBrief(brief: string): string {
  return brief
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .trim()
    .slice(0, MAX_SUBJECT);
}

/**
 * A template planner, not a language model: the same brief always gives the same six shots. It
 * exists so the planner, the batch runner and the CLI have a real contract before an LLM is wired.
 */
export function planCampaign(brief: string): PlannedShot[] {
  const subject = normalizeBrief(brief);
  if (subject === "") {
    throw new Error("brief has no subject after normalization");
  }

  return TEMPLATE.map((template, index) => ({
    index: index + 1,
    title: template.title,
    prompt: `${template.lead} ${subject}`,
    mode: template.mode,
    modelId: defaultModelForMode(template.mode).id,
    durationS: template.durationS,
  }));
}

/**
 * The model's plan when one is configured and every shot validates; the template on any error.
 * A model failure must still leave the batch with a plan it can run, so the fallback is quiet.
 */
export async function planShots(brief: string): Promise<PlanResult> {
  const { llmConfigured, planWithLlm } = await import("./llm");
  if (llmConfigured()) {
    try {
      return { shots: await planWithLlm(brief), source: "model" };
    } catch {
      // Falling back is the contract here: an unreachable or malformed model answer is a
      // reason to use the template, not to fail the request.
    }
  }
  return { shots: planCampaign(brief), source: "template" };
}

export const MIN_BRIEF = 12;
export const MAX_BRIEF = 2000;
