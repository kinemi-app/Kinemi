import cameraData from "../../data/presets/camera.json";
import looksData from "../../data/presets/looks.json";
import type { CameraMove, LookBook, LookOption } from "../types";

const CAMERA_FILE = "data/presets/camera.json";
const LOOKS_FILE = "data/presets/looks.json";

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

function readCameraMoves(raw: unknown): CameraMove[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${CAMERA_FILE}: expected an array of camera moves`);
  }

  const seen = new Set<string>();
  const moves: CameraMove[] = [];

  raw.forEach((row, index) => {
    const where = `${CAMERA_FILE}[${index}]`;
    if (!isRecord(row)) {
      throw new Error(`${where}: expected an object`);
    }
    const move: CameraMove = {
      id: requireString(row, "id", where),
      name: requireString(row, "name", where),
      family: requireString(row, "family", where),
      prompt: requireString(row, "prompt", where),
    };
    if (seen.has(move.id)) {
      throw new Error(`${where}: duplicate id "${move.id}"`);
    }
    seen.add(move.id);
    moves.push(move);
  });

  return moves;
}

function readOptions(raw: unknown, where: string): LookOption[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${where}: expected an array`);
  }

  return raw.map((row, index) => {
    const at = `${where}[${index}]`;
    if (!isRecord(row)) {
      throw new Error(`${at}: expected an object`);
    }
    const option: LookOption = {
      id: requireString(row, "id", at),
      name: requireString(row, "name", at),
    };
    if (typeof row.hint === "string" && row.hint.trim() !== "") {
      option.hint = row.hint;
    }
    return option;
  });
}

function readStrings(raw: unknown, where: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${where}: expected a non-empty array of strings`);
  }

  return raw.map((value, index) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${where}[${index}]: expected a non-empty string`);
    }
    return value;
  });
}

function readLookBook(raw: unknown): LookBook {
  if (!isRecord(raw)) {
    throw new Error(`${LOOKS_FILE}: expected an object`);
  }

  return {
    bodies: readOptions(raw.bodies, `${LOOKS_FILE}.bodies`),
    lenses: readOptions(raw.lenses, `${LOOKS_FILE}.lenses`),
    apertures: readStrings(raw.apertures, `${LOOKS_FILE}.apertures`),
    palettes: readOptions(raw.palettes, `${LOOKS_FILE}.palettes`),
    lighting: readOptions(raw.lighting, `${LOOKS_FILE}.lighting`),
  };
}

/** Every camera move, validated once at module load. A bad preset file fails the build, not the UI. */
export const cameraMoves: CameraMove[] = readCameraMoves(cameraData);

/** Camera bodies, lenses, apertures, palettes and lighting. */
export const lookBook: LookBook = readLookBook(looksData);

export function findCameraMove(id: string): CameraMove | undefined {
  return cameraMoves.find((move) => move.id === id);
}

/** Stable family list for the gallery filter, in file order. */
export function cameraFamilies(): string[] {
  const families: string[] = [];
  for (const move of cameraMoves) {
    if (!families.includes(move.family)) {
      families.push(move.family);
    }
  }
  return families;
}
