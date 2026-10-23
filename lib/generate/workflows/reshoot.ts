import { findModel } from "../../models";
import type { GenerateRequest } from "../../types";
import { requireString, type WorkflowGraph } from "../pipeline";
import { stillCheckpoint } from "./modelFiles";
import { stillGraph } from "./still";
import { wanVideoGraph } from "./wan";

/**
 * Re-shoot: the source still is mandatory and always becomes the graph's start image. An image
 * model samples at a reduced denoise (a still); a video model animates the same still as a short
 * I2V clip, so the model picker never promises a kind the graph does not produce.
 */
export function graph(request: GenerateRequest): WorkflowGraph {
  const imageName = requireString(request.params, "imageName", "re-shoot needs a source still");
  const model = findModel(request.modelId);
  if (model === undefined) {
    throw new Error(`re-shoot does not know model "${request.modelId}"`);
  }

  if (model.kind === "video") {
    return wanVideoGraph(request, { kind: "image", imageName }, "kinemi/reshoot");
  }
  if (model.kind === "image") {
    return stillGraph(request, stillCheckpoint(request.modelId), imageName, "kinemi/reshoot");
  }
  throw new Error(`re-shoot produces no ${model.kind}: model "${request.modelId}" cannot run it`);
}
