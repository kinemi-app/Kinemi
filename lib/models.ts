import modelsData from "../data/models.json";
import type { Mode, Model, ModelKind } from "./types";

const MODELS_FILE = "data/models.json";

export const MODES: Mode[] = [
  "cinematic",
  "reshoot",
  "genjutsu",
  "soul",
  "edit",
  "audio",
  "ads",
  "fashion",
  "upscale",
];

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
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${where}: "${key}" must be a positive number`);
  }
  return value;
}

const MODEL_KINDS: ModelKind[] = ["image", "video", "audio"];

function requireKind(row: Record<string, unknown>, where: string): ModelKind {
  const value = row.kind;
  if (typeof value !== "string" || !MODEL_KINDS.includes(value as ModelKind)) {
    throw new Error(`${where}: "kind" must be one of ${MODEL_KINDS.join(", ")}`);
  }
  return value as ModelKind;
}

function readModels(raw: unknown): Model[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${MODELS_FILE}: expected a non-empty array of models`);
  }

  const seen = new Set<string>();
  const models: Model[] = [];

  raw.forEach((row, index) => {
    const where = `${MODELS_FILE}[${index}]`;
    if (!isRecord(row)) {
      throw new Error(`${where}: expected an object`);
    }
    if (typeof row.open !== "boolean") {
      throw new Error(`${where}: "open" must be a boolean`);
    }
    if (!Array.isArray(row.modes) || row.modes.length === 0) {
      throw new Error(`${where}: "modes" must be a non-empty array`);
    }
    const modes = row.modes.map((mode, modeIndex) => {
      if (typeof mode !== "string" || !MODES.includes(mode as Mode)) {
        throw new Error(`${where}.modes[${modeIndex}]: unknown mode "${String(mode)}"`);
      }
      return mode as Mode;
    });

    const model: Model = {
      id: requireString(row, "id", where),
      name: requireString(row, "name", where),
      vendor: requireString(row, "vendor", where),
      open: row.open,
      creditsPerSecond: requireNumber(row, "creditsPerSecond", where),
      maxDurationS: requireNumber(row, "maxDurationS", where),
      modes,
      kind: requireKind(row, where),
    };
    if (typeof row.note === "string" && row.note.trim() !== "") {
      model.note = row.note;
    }
    if (seen.has(model.id)) {
      throw new Error(`${where}: duplicate id "${model.id}"`);
    }
    seen.add(model.id);
    models.push(model);
  });

  return models;
}

/** Every model in the registry, validated once at module load. */
export const models: Model[] = readModels(modelsData);

export function findModel(id: string): Model | undefined {
  return models.find((model) => model.id === id);
}

/** Models that can serve a mode, in registry order. */
export function modelsForMode(mode: Mode): Model[] {
  return models.filter((model) => model.modes.includes(mode));
}

/** First model that can serve a mode. The registry always has one; throws if that stops being true. */
export function defaultModelForMode(mode: Mode): Model {
  const model = modelsForMode(mode)[0];
  if (!model) {
    throw new Error(`${MODELS_FILE}: no model serves mode "${mode}"`);
  }
  return model;
}
