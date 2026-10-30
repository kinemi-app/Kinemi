import type { GenerateRequest } from "../../types";
import { requireString, type WorkflowGraph } from "../pipeline";
import { addNode, createGraphBuilder } from "./graph";

/**
 * Depth analysis: no sampling, just the Depth Anything V2 preprocessor on an uploaded still. The
 * custom node writes a greyscale depth map, which the deployment's SaveImage returns as the result.
 */

const DEPTH_CHECKPOINT = "depth_anything_v2_vitl.pth";
const DEPTH_SIZE = 1024;
const OUTPUT_PREFIX = "kinemi/depth";

export function graph(request: GenerateRequest): WorkflowGraph {
  const imageName = requireString(
    request.params,
    "imageName",
    "depth analysis needs a source still",
  );

  const builder = createGraphBuilder();
  const image = addNode(builder, "LoadImage", { image: imageName });
  const depth = addNode(builder, "DepthAnythingV2Preprocessor", {
    image: [image, 0],
    ckpt_name: DEPTH_CHECKPOINT,
  });
  addNode(builder, "SaveImage", { images: [depth, 0], filename_prefix: OUTPUT_PREFIX });

  return { nodes: builder.nodes, output: "image", width: DEPTH_SIZE, height: DEPTH_SIZE };
}
