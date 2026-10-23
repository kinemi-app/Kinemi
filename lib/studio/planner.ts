import { defaultModelForMode } from "../models";
import type { Mode } from "../types";

export type PlannedShot = {
  index: number;
  title: string;
  prompt: string;
  mode: Mode;
  modelId: string;
  durationS: number;
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

export const MIN_BRIEF = 12;
export const MAX_BRIEF = 2000;
