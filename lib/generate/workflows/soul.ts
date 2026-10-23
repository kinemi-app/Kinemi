import { findModel } from "../../models";
import type { GenerateRequest } from "../../types";
import { optionalString, type WorkflowGraph } from "../pipeline";
import { stillCheckpoint } from "./modelFiles";
import { stillGraph } from "./still";

/**
 * Soul: one still that carries the chosen palette. A source photo is optional; with it the graph
 * re-renders that photo (image-to-image), without it the graph starts from the prompt alone.
 */
export function graph(request: GenerateRequest): WorkflowGraph {
  const model = findModel(request.modelId);
  if (model === undefined) {
    throw new Error(`Soul does not know model "${request.modelId}"`);
  }
  if (model.kind !== "image") {
    throw new Error(`Soul produces an image; model "${request.modelId}" is ${model.kind}`);
  }

  const imageName = optionalString(request.params, "imageName", "");
  return stillGraph(
    request,
    stillCheckpoint(request.modelId),
    imageName === "" ? undefined : imageName,
    "kinemi/soul",
  );
}
