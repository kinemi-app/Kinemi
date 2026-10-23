import { node, type WorkflowNode } from "../pipeline";

/**
 * A builder for ComfyUI's API format: node ids are strings in creation order, so a mode module
 * reads like the workflow it mirrors instead of numbering nodes by hand.
 */

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;

export type GraphBuilder = {
  nodes: Record<string, WorkflowNode>;
  nextId: number;
};

export function createGraphBuilder(): GraphBuilder {
  return { nodes: {}, nextId: 1 };
}

/** Add one node and return its id, so the next node can point at it. */
export function addNode(
  builder: GraphBuilder,
  classType: string,
  inputs: Record<string, unknown>,
): string {
  const id = String(builder.nextId);
  builder.nextId += 1;
  builder.nodes[id] = node(classType, inputs);
  return id;
}

/** The native video pair: `CreateVideo` turns decoded frames into a clip, `SaveVideo` writes it. */
export function addVideoOutput(
  builder: GraphBuilder,
  images: string,
  prefix: string,
  fps: number,
): void {
  const video = addNode(builder, "CreateVideo", { images: [images, 0], fps });
  addNode(builder, "SaveVideo", {
    video: [video, 0],
    filename_prefix: prefix,
    format: "mp4",
    codec: "h264",
  });
}
