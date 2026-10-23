import templatesData from "../../../data/canvas-templates.json";
import type { CanvasBoard, CanvasNode } from "./board";
import { readBoard } from "./board";

/** A reusable board fragment: the same nodes the board runs, without runtime state or locks. */
export type CanvasTemplate = {
  id: string;
  name: string;
  description: string;
  nodes: CanvasNode[];
};

const FILE = "data/canvas-templates.json";

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

function readTemplate(raw: unknown, where: string): CanvasTemplate {
  if (!isRecord(raw)) {
    throw new Error(`${where}: expected an object`);
  }
  const name = requireString(raw, "name", where);
  const board = readBoard({ version: 1, title: name, nodes: raw.nodes });
  return {
    id: requireString(raw, "id", where),
    name,
    description: requireString(raw, "description", where),
    nodes: board.nodes,
  };
}

function readTemplates(raw: unknown): CanvasTemplate[] {
  if (!isRecord(raw) || !Array.isArray(raw.templates)) {
    throw new Error(`${FILE}: expected an object with a templates array`);
  }
  const seen = new Set<string>();
  return raw.templates.map((row, index) => {
    const template = readTemplate(row, `${FILE}.templates[${index}]`);
    if (seen.has(template.id)) {
      throw new Error(`${FILE}.templates[${index}]: duplicate id "${template.id}"`);
    }
    seen.add(template.id);
    return template;
  });
}

/** The shipped templates, validated once at module load so a bad file fails the build. */
export const canvasTemplates: CanvasTemplate[] = readTemplates(templatesData);

/** Parse an imported template file with the same rules as the shipped file. */
export function parseTemplate(raw: unknown): CanvasTemplate {
  if (isRecord(raw) && Array.isArray(raw.templates)) {
    const template = readTemplates(raw)[0];
    if (!template) {
      throw new Error("The template file has no templates in it.");
    }
    return template;
  }
  return readTemplate(raw, "template");
}

export function findTemplate(id: string): CanvasTemplate | undefined {
  return canvasTemplates.find((template) => template.id === id);
}

/** Apply a template as a fresh board: no locks, no previous run, no leftover result. */
export function templateToBoard(template: CanvasTemplate): CanvasBoard {
  return {
    version: 1,
    title: template.name,
    nodes: template.nodes.map((node) => ({
      ...node,
      status: "idle",
      lock: undefined,
      error: undefined,
      resultUrl: undefined,
      resultKind: undefined,
    })),
  };
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "canvas";
}

/** The current board as an importable template file content. */
export function boardAsTemplate(board: CanvasBoard): { id: string; name: string; description: string; nodes: CanvasNode[] } {
  return {
    id: slugify(board.title),
    name: board.title,
    description: `Saved from the ${board.title} board.`,
    nodes: board.nodes.map((node) => ({
      ...node,
      status: "idle",
      lock: undefined,
      error: undefined,
      resultUrl: undefined,
      resultKind: undefined,
    })),
  };
}

/** The text written by "Download template": one template in the shipped file's format. */
export function templateFileContent(board: CanvasBoard): string {
  return JSON.stringify({ version: 1, templates: [boardAsTemplate(board)] }, null, 2);
}
