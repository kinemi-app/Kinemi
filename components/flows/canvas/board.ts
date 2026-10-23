import { defaultModelForMode, findModel, MODES, modelsForMode } from "../../../lib/models";
import type { Mode, ModelKind } from "../../../lib/types";

/** The board document. It is the saved, shared and exported shape, so it stays plain JSON. */
export type CanvasBoard = {
  version: 1;
  title: string;
  nodes: CanvasNode[];
};

export type NodeLock = {
  id: string;
  name: string;
};

export type NodeStatus = "idle" | "running" | "succeeded" | "failed";

export type CanvasNode = {
  id: string;
  title: string;
  mode: Mode;
  modelId: string;
  prompt: string;
  durationS: number;
  inputId?: string;
  x: number;
  y: number;
  /** Runtime state; it is reset when a board is loaded from storage, a link or a template. */
  status: NodeStatus;
  error?: string;
  resultUrl?: string;
  resultKind?: ModelKind;
  lock?: NodeLock;
};

const BOARD_VERSION = 1;
const MAX_DURATION_S = 60;
const NODE_WIDTH = 304;
const NODE_GAP_X = 376;
const NODE_GAP_Y = 282;
const START_X = 24;
const START_Y = 48;
const STEPS_PER_ROW = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, key: string, where: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function requireNumber(row: Record<string, unknown>, key: string, where: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${where}: "${key}" must be a number`);
  }
  return value;
}

function readMode(row: Record<string, unknown>, where: string): Mode {
  const value = row.mode;
  if (typeof value !== "string" || !MODES.includes(value as Mode)) {
    throw new Error(`${where}: "mode" must be one of ${MODES.join(", ")}`);
  }
  return value as Mode;
}

/** A model id is only kept when the registry still serves the node's mode. */
function readModelId(row: Record<string, unknown>, mode: Mode, where: string): string {
  const value = row.modelId;
  if (typeof value === "string") {
    const model = findModel(value);
    if (model?.modes.includes(mode)) {
      return model.id;
    }
  }
  if (row.modelId !== undefined) {
    throw new Error(`${where}: model "${String(row.modelId)}" does not serve mode "${mode}"`);
  }
  return defaultModelForMode(mode).id;
}

function readDuration(
  row: Record<string, unknown>,
  where: string,
  modelId: string,
): number {
  const model = findModel(modelId) ?? defaultModelForMode("cinematic");
  if (row.durationS === undefined) {
    return 1;
  }
  const value = requireNumber(row, "durationS", where);
  if (value < 1) {
    throw new Error(`${where}: "durationS" must be at least 1`);
  }
  return Math.min(Math.round(value), model.maxDurationS, MAX_DURATION_S);
}

function readLock(row: Record<string, unknown>, where: string): NodeLock | undefined {
  const raw = row.lock;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new Error(`${where}: "lock" must be an object`);
  }
  return {
    id: requireString(raw, "id", `${where}.lock`),
    name: requireString(raw, "name", `${where}.lock`),
  };
}

function readNode(raw: unknown, where: string): CanvasNode {
  if (!isRecord(raw)) {
    throw new Error(`${where}: expected an object`);
  }
  const mode = readMode(raw, where);
  const modelId = readModelId(raw, mode, where);
  const node: CanvasNode = {
    id: requireString(raw, "id", where),
    title: requireString(raw, "title", where),
    mode,
    modelId,
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    durationS: readDuration(raw, where, modelId),
    x: Math.max(0, requireNumber(raw, "x", where)),
    y: Math.max(0, requireNumber(raw, "y", where)),
    status: "idle",
  };
  const inputId = raw.inputId;
  if (typeof inputId === "string" && inputId !== node.id) {
    node.inputId = inputId;
  }
  const lock = readLock(raw, where);
  if (lock) {
    node.lock = lock;
  }
  return node;
}

/** Parse any board-shaped value, with every runtime field reset so a load never resumes a run. */
export function readBoard(raw: unknown): CanvasBoard {
  if (!isRecord(raw)) {
    throw new Error("canvas: the board must be an object");
  }
  if (!Array.isArray(raw.nodes)) {
    throw new Error("canvas: the board needs a nodes array");
  }
  const seen = new Set<string>();
  const nodes = raw.nodes.map((row, index) => {
    const node = readNode(row, `canvas.nodes[${index}]`);
    if (seen.has(node.id)) {
      throw new Error(`canvas.nodes[${index}]: duplicate id "${node.id}"`);
    }
    seen.add(node.id);
    return node;
  });
  for (const node of nodes) {
    if (node.inputId !== undefined && !seen.has(node.inputId)) {
      throw new Error(`canvas: node "${node.id}" points at a missing input "${node.inputId}"`);
    }
  }
  return { version: BOARD_VERSION, title: typeof raw.title === "string" ? raw.title : "Untitled board", nodes };
}

/** One editable starting point, so the board is never an empty screen. */
export function starterBoard(): CanvasBoard {
  const mode: Mode = "soul";
  return {
    version: BOARD_VERSION,
    title: "First board",
    nodes: [
      {
        id: "step-1",
        title: "Key frame",
        mode,
        modelId: defaultModelForMode(mode).id,
        prompt: "A lone figure under a streetlamp, warm sodium light, wet asphalt, cinematic still.",
        durationS: 1,
        x: START_X,
        y: START_Y,
        status: "idle",
      },
    ],
  };
}

export function nextNodeId(nodes: readonly CanvasNode[]): string {
  const used = new Set(nodes.map((node) => node.id));
  let index = 1;
  while (used.has(`step-${index}`)) {
    index += 1;
  }
  return `step-${index}`;
}

/** A new scene node placed in reading order, optionally fed by the selected step. */
export function newNode(board: CanvasBoard, inputId: string | undefined): CanvasNode {
  const mode: Mode = "cinematic";
  const index = board.nodes.length;
  return {
    id: nextNodeId(board.nodes),
    title: `Step ${index + 1}`,
    mode,
    modelId: defaultModelForMode(mode).id,
    prompt: "",
    durationS: Math.min(5, defaultModelForMode(mode).maxDurationS),
    x: START_X + (index % STEPS_PER_ROW) * NODE_GAP_X,
    y: START_Y + Math.floor(index / STEPS_PER_ROW) * NODE_GAP_Y,
    status: "idle",
    ...(inputId ? { inputId } : {}),
  };
}

/** Remove a step and clear any child that pointed at it, so the graph never keeps a dangling edge. */
export function removeNode(board: CanvasBoard, id: string): CanvasBoard {
  return {
    ...board,
    nodes: board.nodes
      .filter((node) => node.id !== id)
      .map((node) => (node.inputId === id ? { ...node, inputId: undefined } : node)),
  };
}

/** Parents before children; a cycle or an orphan falls back to file order instead of hanging. */
export function orderNodes(nodes: readonly CanvasNode[]): CanvasNode[] {
  const remaining = [...nodes];
  const placed = new Set<string>();
  const ordered: CanvasNode[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (node) => node.inputId === undefined || placed.has(node.inputId),
    );
    if (index === -1) {
      ordered.push(...remaining);
      break;
    }
    const [node] = remaining.splice(index, 1);
    if (!node) {
      break;
    }
    ordered.push(node);
    placed.add(node.id);
  }
  return ordered;
}

export function nodeWidth(): number {
  return NODE_WIDTH;
}

export function boardWidth(board: CanvasBoard): number {
  return Math.max(960, ...board.nodes.map((node) => node.x + NODE_WIDTH + START_X));
}

export function boardHeight(board: CanvasBoard): number {
  return Math.max(520, ...board.nodes.map((node) => node.y + 300));
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64(token: string): string {
  const padded = token.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** A board without run results or session locks: what is saved, shared and exported. */
export function snapshotBoard(board: CanvasBoard): CanvasBoard {
  return {
    ...board,
    nodes: board.nodes.map((node) => ({
      ...node,
      status: "idle",
      error: undefined,
      resultUrl: undefined,
      resultKind: undefined,
      lock: undefined,
    })),
  };
}

/** A board in a URL-safe token; the share link is a snapshot, not a live session. */
export function encodeBoard(board: CanvasBoard): string {
  return toBase64(JSON.stringify(snapshotBoard(board)));
}

export function decodeBoard(token: string): CanvasBoard | undefined {
  try {
    return readBoard(JSON.parse(fromBase64(token)));
  } catch {
    return undefined;
  }
}

/** The model a node should run, or undefined when the stored pairing no longer exists. */
export function nodeModel(node: CanvasNode): string | undefined {
  return findModel(node.modelId)?.modes.includes(node.mode) ? node.modelId : undefined;
}

/** Every model that can serve a node's mode, for the card's model picker. */
export function nodeModels(node: CanvasNode) {
  return modelsForMode(node.mode);
}
