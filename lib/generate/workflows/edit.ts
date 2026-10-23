import type { GenerateRequest } from "../../types";
import { optionalNumber, requireString, type WorkflowGraph } from "../pipeline";
import { wanVideoGraph } from "./wan";

/**
 * Edit: re-renders a source clip from an instruction. The clip is mandatory and travels as
 * `params.videoName`; the 1-10 strength slider becomes the VACE control strength. Only the Wan
 * VACE deployment graph is wired, so another model's row answers with a named error.
 */
const MIN_STRENGTH = 1;
const MAX_STRENGTH = 10;
const DEFAULT_STRENGTH = 5;

export function graph(request: GenerateRequest): WorkflowGraph {
  if (request.modelId !== "wan22-i2v") {
    throw new Error(`no edit graph for model "${request.modelId}"`);
  }
  const videoName = requireString(request.params, "videoName", "edit needs a source clip");
  const strength = optionalNumber(request.params, "strength", DEFAULT_STRENGTH);
  const controlStrength = Math.min(1, Math.max(0.1, strength / MAX_STRENGTH));
  if (strength < MIN_STRENGTH || strength > MAX_STRENGTH) {
    throw new Error(`params.strength runs ${MIN_STRENGTH}-${MAX_STRENGTH}`);
  }
  return wanVideoGraph(request, { kind: "video", videoName, controlStrength }, "kinemi/edit");
}
