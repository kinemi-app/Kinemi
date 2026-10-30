import type { GenerateRequest } from "../../types";
import {
  requireInteger,
  requireNumber,
  requireString,
  type WorkflowGraph,
} from "../pipeline";
import { addNode, createGraphBuilder } from "./graph";

/**
 * The upscale chain: Real-ESRGAN grows every frame, an optional deflicker pass smooths exposure,
 * and RIFE doubles the frame count when the run asks for 60 fps. The source clip arrives as a
 * /api/assets name. Demo mode never reaches this file.
 */

type Factor = 2 | 4;
type FrameRate = 30 | 60;

/** Every ESRGAN checkpoint keeps its own scale; the factor picks the matching file. */
const ESRGAN_FILES: Record<Factor, string> = {
  2: "RealESRGAN_x2plus.pth",
  4: "RealESRGAN_x4plus.pth",
};

const RIFE_CHECKPOINT = "rife47.pth";
/** A 30 fps source needs two times the frames to reach 60 fps. */
const RIFE_MULTIPLIER = 2;

const MAX_DEFLICKER = 10;
const MAX_SOURCE_S = 60;

/** The declared frame size follows the factor from a 960x540 source. */
const OUTPUT_SIZES: Record<Factor, { width: number; height: number }> = {
  2: { width: 1920, height: 1080 },
  4: { width: 3840, height: 2160 },
};

function readFactor(params: GenerateRequest["params"]): Factor {
  const factor = requireInteger(params, "factor", "the upscale factor must be 2 or 4");
  if (factor !== 2 && factor !== 4) {
    throw new Error(`the upscale factor must be 2 or 4, got ${factor}`);
  }
  return factor;
}

function readFrameRate(params: GenerateRequest["params"]): FrameRate {
  const fps = requireInteger(params, "fps", "the target fps must be 30 or 60");
  if (fps !== 30 && fps !== 60) {
    throw new Error(`the target fps must be 30 or 60, got ${fps}`);
  }
  return fps;
}

function readDeflicker(params: GenerateRequest["params"]): number {
  const level = requireInteger(params, "deflicker", "the deflicker level runs from 0 to 10");
  if (level < 0 || level > MAX_DEFLICKER) {
    throw new Error(`the deflicker level must run from 0 to ${MAX_DEFLICKER}, got ${level}`);
  }
  return level;
}

/** The panel reads the source length before it submits; the server still trusts no client value. */
function readSourceDuration(params: GenerateRequest["params"]): void {
  const seconds = requireNumber(
    params,
    "sourceDurationS",
    "the upscale needs the source clip's length",
  );
  if (seconds <= 0 || seconds > MAX_SOURCE_S) {
    throw new Error(`params.sourceDurationS must run 1-${MAX_SOURCE_S} seconds, got ${seconds}`);
  }
}

export function graph(request: GenerateRequest): WorkflowGraph {
  const params = request.params;
  const videoName = requireString(params, "videoName", "the upscale needs a source clip");
  const factor = readFactor(params);
  const fps = readFrameRate(params);
  const deflicker = readDeflicker(params);
  readSourceDuration(params);

  const builder = createGraphBuilder();
  const video = addNode(builder, "LoadVideo", { file: videoName });
  const parts = addNode(builder, "GetVideoComponents", { video: [video, 0] });

  const loader = addNode(builder, "UpscaleModelLoader", {
    model_name: ESRGAN_FILES[factor],
  });
  let frames = addNode(builder, "ImageUpscaleWithModel", {
    upscale_model: [loader, 0],
    image: [parts, 0],
  });

  // 0 meaning "off": the node only joins the graph when the user asked for a strength above zero.
  if (deflicker > 0) {
    frames = addNode(builder, "Deflicker", {
      images: [frames, 0],
      strength: deflicker / MAX_DEFLICKER,
    });
  }

  // 30 fps keeps the source rate; 60 fps runs the interpolator instead of asking for made-up frames.
  if (fps === 60) {
    frames = addNode(builder, "RIFE VFI", {
      ckpt_name: RIFE_CHECKPOINT,
      frames: [frames, 0],
      clear_cache_after_n_frames: 10,
      multiplier: RIFE_MULTIPLIER,
      fast_mode: true,
      ensemble: true,
      scale_factor: 1,
    });
  }

  const clip = addNode(builder, "CreateVideo", {
    images: [frames, 0],
    audio: [parts, 1],
    fps: fps === 60 ? 60 : [parts, 2],
  });
  addNode(builder, "SaveVideo", {
    video: [clip, 0],
    filename_prefix: "kinemi/upscale",
    format: "mp4",
    codec: "h264",
  });

  const size = OUTPUT_SIZES[factor];
  return { nodes: builder.nodes, output: "video", width: size.width, height: size.height };
}
