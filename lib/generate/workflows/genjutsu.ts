import type { GenerateRequest } from "../../types";
import { requireString, type WorkflowGraph } from "../pipeline";
import { wanVideoGraph } from "./wan";

/**
 * Genjutsu: motion transfer and object swap from a source clip. The graph is the Wan VACE
 * video-to-video one, which drives the source clip's pixels and timing from `params.videoName`.
 * Models in the registry without a VACE deployment graph get a named error, never another model's
 * output under their name.
 */
export function graph(request: GenerateRequest): WorkflowGraph {
  if (request.modelId !== "wan22-i2v") {
    throw new Error(`no genjutsu graph for model "${request.modelId}"`);
  }
  const videoName = requireString(request.params, "videoName", "genjutsu needs a source clip");
  return wanVideoGraph(
    request,
    { kind: "video", videoName, controlStrength: 0.9 },
    "kinemi/genjutsu",
  );
}
