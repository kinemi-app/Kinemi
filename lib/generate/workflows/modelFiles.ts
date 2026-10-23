/**
 * The checkpoint files the still graphs ask ComfyUI for. The names follow the Comfy-Org
 * repackaging; change one here and in build/model-files.md when the deployment holds a different
 * file. A model with no entry has no still graph yet, which the caller turns into a named 502.
 */
const STILL_CHECKPOINTS: Record<string, string> = {
  "flux-2-dev": "flux2-dev.safetensors",
  "qwen-image": "qwen-image.safetensors",
};

export function stillCheckpoint(modelId: string): string {
  const file = STILL_CHECKPOINTS[modelId];
  if (file === undefined) {
    throw new Error(`no still graph for model "${modelId}"`);
  }
  return file;
}
