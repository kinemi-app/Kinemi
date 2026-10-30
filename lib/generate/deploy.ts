import { publicOrigin } from "../config/runtime";
import type { Mode } from "../types";
import { comfyAuthHeaders, comfyConfigFromEnv } from "./comfy";
import { requirements, type RequirementRow } from "./requirements";

/**
 * Compare what this build's graphs ask for with what a ComfyUI deployment has. The check reads
 * `/object_info` once: its keys are the node classes, and its JSON text is searched for every
 * checkpoint or model file. Nothing here downloads a model or starts a run.
 */

const OBJECT_INFO_TIMEOUT_MS = 30_000;

export type MissingNode = { mode: Mode; modelId: string; feature?: string; node: string };
export type MissingFile = { mode: Mode; modelId: string; feature?: string; file: string };
/** A sample graph this build could not build at all. */
export type RequirementError = {
  mode: Mode;
  modelId: string;
  feature?: string;
  variant?: string;
  message: string;
};

export type DeploymentCheck = {
  ok: boolean;
  origin: string;
  checkedAt: string;
  /** How many sample graphs were attempted; a dropped row fails the contract test. */
  attempted: number;
  missingNodes: MissingNode[];
  missingFiles: MissingFile[];
  errors: RequirementError[];
  modes: Mode[];
};

function objectInfoUrl(settings: { url: string }): string {
  return `${settings.url}/object_info`;
}

async function readObjectInfo(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(OBJECT_INFO_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(`Comfy could not be reached at ${publicOrigin(url)} for the deployment check`, {
      cause,
    });
  }
  if (!response.ok) {
    throw new Error(`Comfy refused the deployment check: HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Comfy answered the deployment check without JSON");
  }
}

export type Comparison = {
  missingNodes: MissingNode[];
  missingFiles: MissingFile[];
  errors: RequirementError[];
};

/**
 * Diff the sampled rows against one `/object_info`. A row whose sample graph this build could not
 * build is an error, never a silently clean deployment: it means the check learned nothing about
 * that model.
 */
export function compareRequirements(
  rows: readonly RequirementRow[],
  nodeNames: ReadonlySet<string>,
  fileText: string,
): Comparison {
  const missingNodes: MissingNode[] = [];
  const missingFiles: MissingFile[] = [];
  const errors: RequirementError[] = [];

  for (const row of rows) {
    const where = {
      mode: row.mode,
      modelId: row.modelId,
      ...(row.feature === undefined ? {} : { feature: row.feature }),
    };

    if (row.error !== undefined) {
      errors.push({ ...where, ...(row.variant === undefined ? {} : { variant: row.variant }), message: row.error });
      continue;
    }
    for (const node of row.nodes) {
      if (!nodeNames.has(node)) {
        missingNodes.push({ ...where, node });
      }
    }
    for (const file of row.files) {
      if (!fileText.includes(file)) {
        missingFiles.push({ ...where, file });
      }
    }
  }

  return { missingNodes, missingFiles, errors };
}

export async function checkDeployment(fetchImpl: typeof fetch = fetch): Promise<DeploymentCheck> {
  const config = comfyConfigFromEnv();
  if (config === undefined) {
    throw new Error("COMFY_URL is not set; the deployment check needs an endpoint");
  }

  const objectInfo = await readObjectInfo(fetchImpl, objectInfoUrl(config), comfyAuthHeaders(config));
  if (typeof objectInfo !== "object" || objectInfo === null || Array.isArray(objectInfo)) {
    throw new Error("Comfy's object_info is not a JSON object");
  }

  const rows = requirements();
  const { missingNodes, missingFiles, errors } = compareRequirements(
    rows,
    new Set(Object.keys(objectInfo)),
    JSON.stringify(objectInfo),
  );

  return {
    ok: missingNodes.length === 0 && missingFiles.length === 0 && errors.length === 0,
    origin: publicOrigin(config.url),
    checkedAt: new Date().toISOString(),
    attempted: rows.length,
    missingNodes,
    missingFiles,
    errors,
    modes: [...new Set(rows.map((row) => row.mode))],
  };
}
