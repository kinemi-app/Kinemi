import type { GenerateRequest, Mode } from "../../types";
import type { WorkflowGraph } from "../pipeline";
import { buildGraph as ads } from "./ads";
import { graph as audio } from "./audio";
import { graph as cloudAudio } from "./audio-cloud";
import { graph as cinematic } from "./cinematic";
import { graph as depth } from "./depth";
import { graph as edit } from "./edit";
import { buildGraph as fashion } from "./fashion";
import { graph as genjutsu } from "./genjutsu";
import { graph as reshoot } from "./reshoot";
import { graph as soul } from "./soul";
import { graph as upscale } from "./upscale";

/**
 * The graph registry. Every mode has one module that turns a request into ComfyUI API-format
 * nodes plus the result kind it declares; the adapter never guesses a kind from a mode name.
 */

type GraphBuilder = (request: GenerateRequest) => WorkflowGraph;

/**
 * Which ComfyUI runs the graph. Only audio differs: Comfy Cloud has the Chatterbox nodes but not
 * AudioGen or the translate node a local install carries. Every other mode loads the same
 * split Comfy-Org files on both.
 */
export type GraphTarget = "cloud" | "local";

const CLOUD_GRAPHS: Partial<Record<Mode, GraphBuilder>> = {
  audio: cloudAudio,
};

const GRAPHS: Record<Mode, GraphBuilder> = {
  cinematic,
  reshoot,
  genjutsu,
  soul,
  edit,
  audio,
  ads,
  fashion,
  upscale,
  depth,
};

/** Whether a graph module is registered for the mode. A module may still refuse a request. */
export function supports(mode: Mode): boolean {
  return GRAPHS[mode] !== undefined;
}

/** Build the graph for a request. A missing mode or model throws with the graph's name. */
export function graphFor(request: GenerateRequest, target: GraphTarget = "local"): WorkflowGraph {
  const build = (target === "cloud" ? CLOUD_GRAPHS[request.mode] : undefined) ?? GRAPHS[request.mode];
  if (build === undefined) {
    throw new Error(`no graph for ${request.mode}`);
  }
  return build(request);
}
