import type { GenerateRequest, Mode } from "../../types";
import type { WorkflowGraph } from "../pipeline";
import { buildGraph as ads } from "./ads";
import { graph as audio } from "./audio";
import { graph as cinematic } from "./cinematic";
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
};

/** Whether a graph module is registered for the mode. A module may still refuse a request. */
export function supports(mode: Mode): boolean {
  return GRAPHS[mode] !== undefined;
}

/** Build the graph for a request. A missing mode or model throws with the graph's name. */
export function graphFor(request: GenerateRequest): WorkflowGraph {
  const build = GRAPHS[request.mode];
  if (build === undefined) {
    throw new Error(`no graph for ${request.mode}`);
  }
  return build(request);
}
