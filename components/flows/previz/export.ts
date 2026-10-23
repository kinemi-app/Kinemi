/**
 * Exports for the 3D previz: a binary glTF cube, a canvas recording, a still and an After Effects
 * camera script. Pure helpers with no React; DOM APIs are only touched inside functions.
 */

export type PrevizKeyframe = {
  time: number;
  position: [number, number, number];
  target: [number, number, number];
};

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const JSON_PADDING = 0x20;
const BIN_PADDING = 0;
const BYTES_PER_FLOAT = 4;
const BYTES_PER_UINT16 = 2;
const GLTF_FLOAT = 5126;
const GLTF_UNSIGNED_SHORT = 5123;
const GLTF_ARRAY_BUFFER = 34962;
const GLTF_ELEMENT_ARRAY_BUFFER = 34963;

/** Eight corners of a 1×1×1 cube standing on y = 0, as xyz triples. */
const CUBE_POSITIONS = [
  -0.5, 0, -0.5,
  0.5, 0, -0.5,
  0.5, 0, 0.5,
  -0.5, 0, 0.5,
  -0.5, 1, -0.5,
  0.5, 1, -0.5,
  0.5, 1, 0.5,
  -0.5, 1, 0.5,
];

/** 36 indices, counter-clockwise from outside, for the six cube faces. */
const CUBE_INDICES = [
  0, 1, 2, 0, 2, 3,
  4, 6, 5, 4, 7, 6,
  0, 5, 1, 0, 4, 5,
  3, 2, 6, 3, 6, 7,
  0, 3, 7, 0, 7, 4,
  1, 6, 2, 1, 5, 6,
];

const POSITION_BYTES = CUBE_POSITIONS.length * BYTES_PER_FLOAT;
const INDEX_BYTES = CUBE_INDICES.length * BYTES_PER_UINT16;
const BIN_BYTES = POSITION_BYTES + INDEX_BYTES;

const RECORDING_MS = 3000;
const RECORDING_FPS = 30;
const WEBM_MIME_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

const AE_COMP_NAME = "Kinemi Previz";
const AE_COMP_WIDTH = 1920;
const AE_COMP_HEIGHT = 1080;
const AE_COMP_FPS = 30;
const AE_MIN_SECONDS = 1;

function buildCubeBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(BIN_BYTES);
  const view = new DataView(buffer);
  CUBE_POSITIONS.forEach((position, index) => {
    view.setFloat32(index * BYTES_PER_FLOAT, position, true);
  });
  CUBE_INDICES.forEach((index, offset) => {
    view.setUint16(POSITION_BYTES + offset * BYTES_PER_UINT16, index, true);
  });
  return buffer;
}

function buildGlbDocument(): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "Kinemi 3D Previz" },
    scene: 0,
    scenes: [{ name: "Previz scene", nodes: [0] }],
    nodes: [{ name: "Greybox cube", mesh: 0 }],
    meshes: [
      {
        name: "Greybox cube",
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      {
        name: "Greybox",
        pbrMetallicRoughness: {
          baseColorFactor: [0.62, 0.64, 0.7, 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
    ],
    buffers: [{ byteLength: BIN_BYTES }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: POSITION_BYTES, target: GLTF_ARRAY_BUFFER },
      {
        buffer: 0,
        byteOffset: POSITION_BYTES,
        byteLength: INDEX_BYTES,
        target: GLTF_ELEMENT_ARRAY_BUFFER,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: GLTF_FLOAT,
        count: CUBE_POSITIONS.length / 3,
        type: "VEC3",
        min: [-0.5, 0, -0.5],
        max: [0.5, 1, 0.5],
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: GLTF_UNSIGNED_SHORT,
        count: CUBE_INDICES.length,
        type: "SCALAR",
      },
    ],
  };
}

/** Pad a chunk to the 4-byte boundary glTF requires, with spaces for JSON and zeros for BIN. */
function padToFour(bytes: Uint8Array, fill: number): Uint8Array {
  const remainder = bytes.byteLength % 4;
  if (remainder === 0) {
    return bytes;
  }
  const padded = new Uint8Array(bytes.byteLength + (4 - remainder));
  padded.set(bytes);
  padded.fill(fill, bytes.byteLength);
  return padded;
}

function writeChunk(view: DataView, offset: number, type: number, data: Uint8Array): number {
  view.setUint32(offset, data.byteLength, true);
  view.setUint32(offset + 4, type, true);
  new Uint8Array(view.buffer, offset + GLB_CHUNK_HEADER_BYTES, data.byteLength).set(data);
  return offset + GLB_CHUNK_HEADER_BYTES + data.byteLength;
}

/** A self-contained GLB 2.0 file with one grey cube, ready for a viewer or a DCC import. */
export function buildGlb(): Blob {
  const bin = padToFour(new Uint8Array(buildCubeBuffer()), BIN_PADDING);
  const json = padToFour(
    new TextEncoder().encode(JSON.stringify(buildGlbDocument())),
    JSON_PADDING,
  );
  const total =
    GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES * 2 + json.byteLength + bin.byteLength;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, total, true);
  const afterJson = writeChunk(view, GLB_HEADER_BYTES, GLB_JSON_CHUNK, json);
  writeChunk(view, afterJson, GLB_BIN_CHUNK, bin);
  return new Blob([buffer], { type: "model/gltf-binary" });
}

function createRecorder(stream: MediaStream, mimeType: string): MediaRecorder {
  try {
    return new MediaRecorder(stream, { mimeType });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("The browser refused the WebM recorder settings.", { cause: error });
  }
}

/**
 * Record the canvas for three seconds and resolve with the WebM blob. Rejects with a readable
 * message when the browser has no canvas capture, no MediaRecorder or no WebM encoder.
 */
export function exportWebM(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") {
    return Promise.reject(new Error("This browser cannot record video: MediaRecorder is unavailable."));
  }
  if (typeof canvas.captureStream !== "function") {
    return Promise.reject(
      new Error("This browser cannot capture the canvas: captureStream is unavailable."),
    );
  }
  const mimeType = WEBM_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    return Promise.reject(new Error("This browser has no WebM encoder available."));
  }

  return new Promise<Blob>((resolve, reject) => {
    const stream = canvas.captureStream(RECORDING_FPS);
    let recorder: MediaRecorder;
    try {
      recorder = createRecorder(stream, mimeType);
    } catch (error) {
      reject(error);
      return;
    }

    const chunks: Blob[] = [];
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      finish();
      if (chunks.length === 0) {
        reject(new Error("The recording came back empty; the canvas may not have drawn."));
        return;
      }
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = () => {
      finish();
      reject(new Error("The browser stopped the recording before it finished."));
    };

    recorder.start();
    timer = window.setTimeout(() => recorder.stop(), RECORDING_MS);
  });
}

/** The current canvas as a PNG; rejects when the browser cannot encode it. */
export function exportPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("The browser could not encode the canvas as a PNG."));
    }, "image/png");
  });
}

function buildAeJsx(keyframes: PrevizKeyframe[], json: string): string {
  const lastTime = keyframes.reduce((latest, keyframe) => Math.max(latest, keyframe.time), 0);
  const duration = Math.max(AE_MIN_SECONDS, lastTime + 1).toFixed(2);
  return [
    "// Kinemi 3D Previz camera export.",
    "// After Effects: File > Scripts > Run Script File, then pick this file.",
    "// The matching .json holds the same keyframe data embedded below.",
    "",
    `var keyframes = ${json};`,
    "",
    'app.beginUndoGroup("Kinemi Previz camera");',
    `var comp = app.project.items.addComp("${AE_COMP_NAME}", ${AE_COMP_WIDTH}, ${AE_COMP_HEIGHT}, 1, ${duration}, ${AE_COMP_FPS});`,
    'var camera = comp.layers.addCamera("Kinemi Camera", [comp.width / 2, comp.height / 2]);',
    'var position = camera.property("ADBE Transform Group").property("ADBE Position");',
    'var pointOfInterest = camera.property("ADBE Transform Group").property("ADBE Anchor Point");',
    "",
    "for (var i = 0; i < keyframes.length; i++) {",
    "  var keyframe = keyframes[i];",
    "  position.setValueAtTime(keyframe.time, keyframe.position);",
    "  pointOfInterest.setValueAtTime(keyframe.time, keyframe.target);",
    "}",
    "",
    "app.endUndoGroup();",
    "",
  ].join("\n");
}

/** An After Effects camera script and the keyframe JSON it is built from. */
export function buildAeScript(keyframes: PrevizKeyframe[]): { jsx: string; json: string } {
  const json = JSON.stringify(keyframes, null, 2);
  return { jsx: buildAeJsx(keyframes, json), json };
}
