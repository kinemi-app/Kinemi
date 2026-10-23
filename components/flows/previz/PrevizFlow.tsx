"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Button, Panel, Slider } from "../../ui";
import flowStyles from "../flow.module.css";
import { buildAeScript, buildGlb, exportPng, exportWebM } from "./export";
import type { PrevizKeyframe } from "./export";
import { convertWebmToMp4 } from "./mp4";
import styles from "./previz.module.css";

type Vec3 = [number, number, number];
type Camera = { yaw: number; pitch: number; distance: number };
type ScreenPoint = { x: number; y: number; z: number };
type Project = (point: Vec3) => ScreenPoint | undefined;

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const VIEW_FOV = 42;
const TARGET: Vec3 = [0, 0.6, 0];
const DEFAULT_CAMERA: Camera = { yaw: 35, pitch: 18, distance: 4.4 };

/** The 1 m greybox cube, standing on the floor. */
const CUBE: Vec3[] = [
  [-0.5, 0, -0.5],
  [0.5, 0, -0.5],
  [0.5, 0, 0.5],
  [-0.5, 0, 0.5],
  [-0.5, 1, -0.5],
  [0.5, 1, -0.5],
  [0.5, 1, 0.5],
  [-0.5, 1, 0.5],
];

const FACES = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [1, 5, 6, 2],
  [2, 6, 7, 3],
  [3, 7, 4, 0],
];

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cameraPosition(camera: Camera): Vec3 {
  const yaw = (camera.yaw * Math.PI) / 180;
  const pitch = (camera.pitch * Math.PI) / 180;
  return [
    TARGET[0] + camera.distance * Math.sin(yaw) * Math.cos(pitch),
    TARGET[1] + camera.distance * Math.sin(pitch),
    TARGET[2] + camera.distance * Math.cos(yaw) * Math.cos(pitch),
  ];
}

/** A pinhole projection for one camera pose, in the canvas's own pixels. */
function projector(camera: Camera): Project {
  const eye = cameraPosition(camera);
  const forward = normalize(subtract(TARGET, eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const focal = CANVAS_HEIGHT / (2 * Math.tan((VIEW_FOV * Math.PI) / 360));

  return (point) => {
    const offset = subtract(point, eye);
    const z = dot(offset, forward);
    if (z <= 0.15) {
      return undefined;
    }
    return {
      x: CANVAS_WIDTH / 2 + (dot(offset, right) / z) * focal,
      y: CANVAS_HEIGHT / 2 - (dot(offset, up) / z) * focal,
      z,
    };
  };
}

function drawBackdrop(context: CanvasRenderingContext2D, width: number, height: number): void {
  const backdrop = context.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, "#151a24");
  backdrop.addColorStop(1, "#090b10");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);
}

function drawGrid(context: CanvasRenderingContext2D, project: Project): void {
  const line = (from: Vec3, to: Vec3) => {
    const start = project(from);
    const end = project(to);
    if (!start || !end) {
      return;
    }
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  };

  context.lineWidth = 1;
  context.strokeStyle = "rgba(139, 156, 183, 0.22)";
  for (let offset = -3; offset <= 3; offset += 0.5) {
    line([offset, 0, -3], [offset, 0, 3]);
    line([-3, 0, offset], [3, 0, offset]);
  }
}

function drawFaces(context: CanvasRenderingContext2D, project: Project): void {
  const faces = FACES.map((face) => {
    const drawn: ScreenPoint[] = [];
    for (const index of face) {
      const corner = CUBE[index];
      const point = corner ? project(corner) : undefined;
      if (!point) {
        return undefined;
      }
      drawn.push(point);
    }
    const depth = drawn.reduce((sum, point) => sum + point.z, 0) / drawn.length;
    return { points: drawn, depth };
  })
    .filter((face): face is { points: ScreenPoint[]; depth: number } => face !== undefined)
    .sort((left, right) => right.depth - left.depth);

  for (const face of faces) {
    context.beginPath();
    face.points.forEach((point, corner) => {
      if (corner === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.closePath();
    context.fillStyle = "rgba(158, 178, 214, 0.15)";
    context.fill();
    context.strokeStyle = "rgba(196, 214, 244, 0.55)";
    context.stroke();
  }
}

function drawKeyframes(
  context: CanvasRenderingContext2D,
  project: Project,
  keyframes: PrevizKeyframe[],
): void {
  keyframes.forEach((frame, index) => {
    const point = project(frame.position);
    if (!point) {
      return;
    }
    context.beginPath();
    context.arc(point.x, point.y, 5, 0, Math.PI * 2);
    context.fillStyle = "#d9a441";
    context.fill();
    context.fillStyle = "rgba(245, 245, 247, 0.92)";
    context.fillText(`K${index + 1}`, point.x + 8, point.y - 8);
  });
}

function paint(canvas: HTMLCanvasElement, camera: Camera, keyframes: PrevizKeyframe[]): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  drawBackdrop(context, canvas.width, canvas.height);
  const project = projector(camera);
  drawGrid(context, project);
  drawFaces(context, project);

  context.font = "12px ui-sans-serif, system-ui, sans-serif";
  drawKeyframes(context, project, keyframes);
  context.fillStyle = "rgba(169, 169, 180, 0.85)";
  context.fillText("Greybox · 1 m cube · orbit with the sliders", 18, canvas.height - 18);
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The keyframe list and the After Effects handoff for D3. */
function useKeyframes(camera: Camera, notify: (message: string) => void) {
  const [frames, setFrames] = useState<PrevizKeyframe[]>([]);

  function currentKeyframe(): PrevizKeyframe {
    return { time: frames.length, position: cameraPosition(camera), target: TARGET };
  }

  function addFrame() {
    setFrames((previous) => [
      ...previous,
      { time: previous.length, position: cameraPosition(camera), target: TARGET },
    ]);
    notify("Camera keyframe added.");
  }

  function clearFrames() {
    setFrames([]);
    notify("Camera keyframes cleared.");
  }

  function downloadAeScript() {
    const written = frames.length > 0 ? frames : [currentKeyframe()];
    const { jsx, json } = buildAeScript(written);
    saveBlob("kinemi-previz.jsx", new Blob([jsx], { type: "text/plain" }));
    saveBlob("kinemi-previz-keyframes.json", new Blob([json], { type: "application/json" }));
    notify(`Wrote ${written.length} camera keyframe${written.length === 1 ? "" : "s"} for After Effects.`);
  }

  return { frames, addFrame, clearFrames, downloadAeScript };
}

/** Record three seconds, convert through the server, and fall back to the WebM on any failure. */
async function saveClip(canvas: HTMLCanvasElement, notify: (message: string) => void): Promise<void> {
  notify("Recording three seconds of the canvas…");

  let webm: Blob;
  try {
    webm = await exportWebM(canvas);
  } catch {
    notify("This browser cannot record the canvas.");
    return;
  }

  try {
    saveBlob("kinemi-previz.mp4", await convertWebmToMp4(webm));
    notify("Wrote kinemi-previz.mp4.");
  } catch (cause) {
    saveBlob("kinemi-previz.webm", webm);
    const reason = cause instanceof Error ? cause.message : "the MP4 export failed";
    notify(`${reason}. Wrote kinemi-previz.webm instead.`);
  }
}

/** The GLB, clip and still downloads for D2. */
function useExports(canvasRef: RefObject<HTMLCanvasElement | null>, notify: (message: string) => void) {
  const [exporting, setExporting] = useState(false);

  function downloadGlb() {
    saveBlob("kinemi-previz.glb", buildGlb());
    notify("Wrote kinemi-previz.glb.");
  }

  async function downloadClip() {
    const canvas = canvasRef.current;
    if (!canvas || exporting) {
      return;
    }
    setExporting(true);
    try {
      await saveClip(canvas, notify);
    } finally {
      setExporting(false);
    }
  }

  async function downloadStill() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    try {
      saveBlob("kinemi-previz.png", await exportPng(canvas));
      notify("Wrote kinemi-previz.png.");
    } catch {
      notify("This browser could not write the still.");
    }
  }

  return { exporting, downloadGlb, downloadClip, downloadStill };
}

type StageProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  camera: Camera;
  onCamera: (camera: Camera) => void;
};

function PrevizStage({ canvasRef, camera, onCamera }: StageProps) {
  return (
    <Panel title="3D previz" subtitle="D1 · orbit a greybox scene without leaving the browser.">
      <div className={styles.viewer}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className={styles.canvas}
          aria-label="Greybox 3D preview"
        />
      </div>
      <div className={styles.sliders}>
        <Slider
          label="Orbit"
          value={camera.yaw}
          min={-180}
          max={180}
          unit="°"
          onChange={(yaw) => onCamera({ ...camera, yaw })}
        />
        <Slider
          label="Elevation"
          value={camera.pitch}
          min={-5}
          max={70}
          unit="°"
          onChange={(pitch) => onCamera({ ...camera, pitch })}
        />
        <Slider
          label="Distance"
          value={camera.distance}
          min={2}
          max={8}
          step={0.1}
          unit=" m"
          onChange={(distance) => onCamera({ ...camera, distance })}
        />
      </div>
      <div className={styles.row}>
        <Button variant="ghost" onClick={() => onCamera(DEFAULT_CAMERA)}>
          Reset camera
        </Button>
        <span className={styles.meta}>{camera.distance.toFixed(1)} m from the target</span>
      </div>
    </Panel>
  );
}

type ExportProps = {
  exporting: boolean;
  onGlb: () => void;
  onClip: () => void;
  onStill: () => void;
};

function ExportPanel({ exporting, onGlb, onClip, onStill }: ExportProps) {
  return (
    <Panel title="Exports" subtitle="D2 · GLB for the scene, PNG for the frame, MP4 for the clip.">
      <div className={styles.actions}>
        <Button onClick={onGlb}>Export GLB</Button>
        <Button onClick={onClip} disabled={exporting}>
          {exporting ? "Exporting…" : "Export clip"}
        </Button>
        <Button onClick={onStill}>Export still</Button>
      </div>
      <p className={styles.note}>
        The clip is a three-second canvas recording. The server converts it to MP4 with ffmpeg; when
        ffmpeg is unavailable, the WebM downloads instead.
      </p>
    </Panel>
  );
}

type MotionProps = {
  frames: PrevizKeyframe[];
  onAdd: () => void;
  onClear: () => void;
  onDownload: () => void;
};

function MotionPanel({ frames, onAdd, onClear, onDownload }: MotionProps) {
  return (
    <Panel title="Motion designer" subtitle="D3 · camera keyframes for After Effects and Premiere.">
      <div className={styles.actions}>
        <Button onClick={onAdd}>Add keyframe</Button>
        <Button variant="ghost" onClick={onClear} disabled={frames.length === 0}>
          Clear keyframes
        </Button>
        <Button onClick={onDownload}>Download AE script</Button>
      </div>
      {frames.length === 0 ? (
        <p className={styles.note}>Add a keyframe to capture the current camera.</p>
      ) : (
        <ol className={styles.keys}>
          {frames.map((frame, index) => (
            <li key={`${frame.time}-${index}`}>
              <span>K{index + 1}</span>
              <span>{frame.time.toFixed(1)} s</span>
              <span>{frame.position.map((value) => value.toFixed(1)).join(", ")}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** The 3D Previz route: D1 orbit viewer, D2 exports, D3 camera keyframes. */
export function PrevizFlow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [notice, setNotice] = useState("");
  const keyframes = useKeyframes(camera, setNotice);
  const exports = useExports(canvasRef, setNotice);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      paint(canvas, camera, keyframes.frames);
    }
  }, [camera, keyframes.frames]);

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Previz</span>
        <h1>3D Previz</h1>
        <p className={flowStyles.lead}>
          Greybox a scene in the browser, orbit the camera, then take the result out: a GLB, a still,
          a short clip, or camera keyframes for After Effects and Premiere.
        </p>
      </header>

      <div className={styles.layout}>
        <PrevizStage canvasRef={canvasRef} camera={camera} onCamera={setCamera} />
        <div className={styles.side}>
          <ExportPanel
            exporting={exports.exporting}
            onGlb={exports.downloadGlb}
            onClip={exports.downloadClip}
            onStill={exports.downloadStill}
          />
          <MotionPanel
            frames={keyframes.frames}
            onAdd={keyframes.addFrame}
            onClear={keyframes.clearFrames}
            onDownload={keyframes.downloadAeScript}
          />
          {notice ? (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
