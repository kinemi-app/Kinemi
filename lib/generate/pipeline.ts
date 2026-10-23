import type { GenerateRequest, JobResult } from "../types";

/**
 * The contract between a mode's workflow module and the Comfy adapter: a graph is a map of node
 * ids to Comfy API-format nodes plus the output kind it declares. The registry sends `nodes` as
 * the prompt body and reads `output` when the history comes back, so a mode never guesses its
 * result kind from its name.
 */
export type WorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

export type WorkflowOutput = JobResult["kind"];

export type WorkflowGraph = {
  nodes: Record<string, WorkflowNode>;
  output: WorkflowOutput;
  width: number;
  height: number;
};

export function node(classType: string, inputs: Record<string, unknown>): WorkflowNode {
  return { class_type: classType, inputs };
}

type Params = GenerateRequest["params"];

function param(params: Params, key: string): string | number | boolean | undefined {
  return params?.[key];
}

/** A required asset name or setting; the message says which upload or control is missing. */
export function requireString(params: Params, key: string, message: string): string {
  const value = param(params, key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${message}: params.${key} is missing or empty`);
  }
  return value;
}

export function optionalString(params: Params, key: string, fallback: string): string {
  const value = param(params, key);
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`params.${key} must be a non-empty string when given`);
  }
  return value;
}

export function requireNumber(params: Params, key: string, message: string): number {
  const value = param(params, key);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${message}: params.${key} must be a number`);
  }
  return value;
}

export function optionalNumber(params: Params, key: string, fallback: number): number {
  const value = param(params, key);
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`params.${key} must be a number when given`);
  }
  return value;
}

/** A whole-number setting such as a factor, a frame rate or a strength step. */
export function requireInteger(params: Params, key: string, message: string): number {
  const value = requireNumber(params, key, message);
  if (!Number.isInteger(value)) {
    throw new Error(`${message}: params.${key} must be a whole number`);
  }
  return value;
}

export function optionalInteger(params: Params, key: string, fallback: number): number {
  const value = optionalNumber(params, key, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`params.${key} must be a whole number when given`);
  }
  return value;
}
