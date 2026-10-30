#!/usr/bin/env node
/**
 * Rebuilds data/model-sources.json from the official sources (a community repo is a last-resort
 * fallback, marked `community: true`). Every weight the local graphs load
 * (lib/generate/workflows/**) is looked up in the Hugging Face file tree or the GitHub release it
 * ships in, and recorded with a commit-pinned URL, its size and its sha256 (a gated repo hides the
 * hash: such a row has `sha256: null` and `gated: true`). A node pack is recorded
 * with the commit `git ls-remote` reports and only when its source registers the class a graph
 * uses. Whatever cannot be confirmed goes to `misses`, never into the verified lists. No weight is
 * downloaded: only repository metadata and a few small source files are read.
 */
import { execFile } from "node:child_process";
import console from "node:console";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const OUTPUT = fileURLToPath(new URL("../data/model-sources.json", import.meta.url));
const HF = "https://huggingface.co";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_SUGGESTIONS = 6;

const RESTRICTED = new Set([401, 403]);
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Repos that are not the model's publisher. A weight resolved there is recorded with `community: true`. */
const COMMUNITY_REPOS = new Set(["Kijai/LTXV2_comfy"]);

/** Weights a ComfyUI loader node reads, by the `models/<folder>` that loader scans. Repos are tried in order. */
const WEIGHTS = [
  { file: "ae.safetensors", folder: "vae", repos: ["black-forest-labs/FLUX.1-schnell", "Comfy-Org/Lumina_Image_2.0_Repackaged", "Comfy-Org/Flux-1-Schnell"] },
  { file: "clip_l.safetensors", folder: "text_encoders", repos: ["comfyanonymous/flux_text_encoders"] },
  { file: "t5xxl_fp16.safetensors", folder: "text_encoders", repos: ["comfyanonymous/flux_text_encoders"] },
  { file: "flux1-dev-kontext_fp8_scaled.safetensors", folder: "diffusion_models", repos: ["Comfy-Org/flux1-kontext-dev_ComfyUI"] },
  { file: "flux2_dev_fp8mixed.safetensors", folder: "diffusion_models", repos: ["Comfy-Org/flux2-dev"] },
  { file: "mistral_3_small_flux2_fp8.safetensors", folder: "text_encoders", repos: ["Comfy-Org/flux2-dev"] },
  { file: "flux2-vae.safetensors", folder: "vae", repos: ["Comfy-Org/flux2-dev"] },
  { file: "flux-2-klein-4b.safetensors", folder: "diffusion_models", repos: ["Comfy-Org/flux2-klein-4B", "Comfy-Org/flux2-klein"] },
  { file: "qwen_3_4b.safetensors", folder: "text_encoders", repos: ["Comfy-Org/z_image_turbo", "Comfy-Org/flux2-klein-4B"] },
  { file: "qwen_image_fp8_e4m3fn.safetensors", folder: "diffusion_models", repos: ["Comfy-Org/Qwen-Image_ComfyUI"] },
  { file: "qwen_2.5_vl_7b_fp8_scaled.safetensors", folder: "text_encoders", repos: ["Comfy-Org/Qwen-Image_ComfyUI"] },
  { file: "qwen_image_vae.safetensors", folder: "vae", repos: ["Comfy-Org/Qwen-Image_ComfyUI"] },
  { file: "qwen_image_edit_2509_fp8_e4m3fn.safetensors", folder: "diffusion_models", repos: ["Comfy-Org/Qwen-Image-Edit_ComfyUI"] },
  ...["t2v", "i2v"].flatMap((kind) =>
    ["high", "low"].map((noise) => ({
      file: `wan2.2_${kind}_${noise}_noise_14B_fp8_scaled.safetensors`,
      folder: "diffusion_models",
      repos: ["Comfy-Org/Wan_2.2_ComfyUI_Repackaged"],
    })),
  ),
  { file: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", folder: "text_encoders", repos: ["Comfy-Org/Wan_2.1_ComfyUI_repackaged", "Comfy-Org/Wan_2.2_ComfyUI_Repackaged"] },
  { file: "wan_2.1_vae.safetensors", folder: "vae", repos: ["Comfy-Org/Wan_2.1_ComfyUI_repackaged", "Comfy-Org/Wan_2.2_ComfyUI_Repackaged"] },
  { file: "clip_vision_h.safetensors", folder: "clip_vision", repos: ["Comfy-Org/Wan_2.1_ComfyUI_repackaged"] },
  { file: "wan2.1_vace_14B_fp16.safetensors", folder: "diffusion_models", repos: ["Comfy-Org/Wan_2.1_ComfyUI_repackaged"] },
  { file: "ltx-2-19b-dev-fp8_transformer_only.safetensors", folder: "diffusion_models", repos: ["Comfy-Org/ltx-2", "Lightricks/LTX-2", "Kijai/LTXV2_comfy"] },
  { file: "LTX2_video_vae_bf16.safetensors", folder: "vae", repos: ["Comfy-Org/ltx-2", "Lightricks/LTX-2", "Kijai/LTXV2_comfy"] },
  { file: "gemma_3_12B_it_fp4_mixed.safetensors", folder: "text_encoders", repos: ["Comfy-Org/ltx-2", "Lightricks/LTX-2"] },
  { file: "ltx-2-19b-embeddings_connector_dev_bf16.safetensors", folder: "text_encoders", repos: ["Comfy-Org/ltx-2", "Lightricks/LTX-2", "Kijai/LTXV2_comfy"] },
  { file: "ltx-2.5-22b-dev-transformer-bf16.safetensors", folder: "diffusion_models", repos: ["Lightricks/LTX-2.5", "Comfy-Org/ltx-2.5", "Comfy-Org/ltx-2.3"] },
  { file: "ltx-2.5-video-vae-bf16.safetensors", folder: "vae", repos: ["Lightricks/LTX-2.5", "Comfy-Org/ltx-2.5", "Comfy-Org/ltx-2.3"] },
  { file: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors", folder: "text_encoders", repos: ["Lightricks/LTX-2.5", "Comfy-Org/ltx-2.5", "Comfy-Org/gemma-4"] },
  { file: "hunyuanvideo1.5_720p_t2v_fp16.safetensors", folder: "diffusion_models", repos: ["Comfy-Org/HunyuanVideo_1.5_repackaged"] },
  { file: "hunyuanvideo15_vae_fp16.safetensors", folder: "vae", repos: ["Comfy-Org/HunyuanVideo_1.5_repackaged"] },
  { file: "byt5_small_glyphxl_fp16.safetensors", folder: "text_encoders", repos: ["Comfy-Org/HunyuanVideo_1.5_repackaged"] },
];

/** GitHub release assets; the folder is the one UpscaleModelLoader scans. */
const RELEASE_ASSETS = [
  { file: "RealESRGAN_x2plus.pth", folder: "upscale_models", repo: "xinntao/Real-ESRGAN" },
  { file: "RealESRGAN_x4plus.pth", folder: "upscale_models", repo: "xinntao/Real-ESRGAN" },
];

/**
 * Node classes the local graphs use that are not in ComfyUI core. A pack counts only when `path`
 * at the pinned commit contains `contains`, so a repository that merely exists proves nothing.
 */
const NODE_CLASSES = [
  { class: "RIFE VFI", repo: "Fannovel16/ComfyUI-Frame-Interpolation", path: "__init__.py", contains: '"RIFE VFI": RIFE_VFI' },
  { class: "DepthAnythingV2Preprocessor", repo: "Fannovel16/comfyui_controlnet_aux", path: "node_wrappers/depth_anything_v2.py", contains: '"DepthAnythingV2Preprocessor"' },
  { class: "ChatterboxTTS", repo: "wildminder/ComfyUI-Chatterbox", path: "nodes/tts_node.py", contains: '"ChatterboxTTS"' },
  { class: "ChatterboxVC", repo: "wildminder/ComfyUI-Chatterbox", path: "nodes/vc_node.py", contains: '"ChatterboxVC"' },
  { class: "Deflicker", repo: "karcsiha/comfyUi-deflicker", path: "__init__.py", contains: '"Deflicker":' },
  { class: "AudioGen" },
  { class: "AudioMatch" },
  { class: "WhisperTranscribe" },
  { class: "TranslateText" },
];

/** Files a node pack fetches itself on first use; the source line is read from the pinned pack. */
const AUTO_DOWNLOADED = [
  {
    file: "rife47.pth",
    pack: "Fannovel16/ComfyUI-Frame-Interpolation",
    path: "vfi_utils.py",
    contains: "download_url_to_file",
    why: "the RIFE VFI node downloads rife47.pth into its own ckpts folder from the release mirrors listed in vfi_utils.py",
  },
  {
    file: "depth_anything_v2_vitl.pth",
    pack: "Fannovel16/comfyui_controlnet_aux",
    path: "src/custom_controlnet_aux/depth_anything_v2/__init__.py",
    contains: "custom_hf_download",
    why: "DepthAnythingV2Preprocessor fetches the checkpoint from Hugging Face through custom_hf_download on first use",
  },
];

const hfRepoCache = new Map();

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { "user-agent": "kinemi-verify-model-sources" } });
}

/**
 * The sha256 to record for a tree entry, or why there is none. A gated repo's tree API masks the oid
 * (64 asterisks), so a non-hex oid is only accepted when an anonymous HEAD on the pinned resolve URL
 * answers 401 GatedRepo: then the row is `gated` with no hash. A masked value is never recorded.
 */
async function hashOf(oid, url) {
  if (SHA256_HEX.test(oid)) {
    return { sha256: oid };
  }
  let response;
  try {
    response = await request(url, { method: "HEAD", redirect: "manual" });
  } catch (error) {
    return { reason: `oid is not a sha256 and the HEAD check failed: ${error.message}` };
  }
  if (response.status === 401 && response.headers.get("x-error-code") === "GatedRepo") {
    return { sha256: null, gated: true };
  }
  return { reason: `oid is not a sha256 and the resolve URL answered HTTP ${response.status}, not a gated 401` };
}

/** Parses the `next` page URL out of a Link header, or returns undefined. */
function nextPage(response) {
  const match = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "");
  return match === null ? undefined : match[1];
}

/** One repo: its canonical id, the commit `main` points at, and its file tree at that commit. */
async function loadHfRepo(repo) {
  if (!hfRepoCache.has(repo)) {
    hfRepoCache.set(repo, fetchHfRepo(repo));
  }
  return hfRepoCache.get(repo);
}

async function fetchHfRepo(repo) {
  const info = await request(`${HF}/api/models/${repo}`);
  if (!info.ok) {
    return { repo, status: info.status };
  }
  const { id, sha } = await info.json();
  const entries = [];
  let url = `${HF}/api/models/${id}/tree/${sha}?recursive=true`;
  while (url !== undefined) {
    const page = await request(url);
    if (!page.ok) {
      return { repo, status: page.status };
    }
    entries.push(...(await page.json()));
    url = nextPage(page);
  }
  return { repo, id, sha, files: entries.filter((entry) => entry.type === "file") };
}

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

/** The single tree entry for `file`; several matches narrow to the one inside `folder`, else none. */
function findEntry(files, file, folder) {
  const matches = files.filter((entry) => basename(entry.path) === file);
  const inFolder = matches.filter((entry) => entry.path.split("/").includes(folder));
  return matches.length === 1 ? matches[0] : inFolder.length === 1 ? inFolder[0] : undefined;
}

/** Same extension and same leading word as the missing file: where the official name likely differs. */
function suggestionsFor(file, loaded) {
  const stem = file.split(/[-_.]/)[0].toLowerCase();
  return loaded
    .flatMap((repo) => (repo.files ?? []).map((entry) => ({ repo: repo.id, path: entry.path })))
    .filter((entry) => basename(entry.path).toLowerCase().startsWith(stem))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => `${entry.repo}/${entry.path}`);
}

async function verifyHfWeight({ file, folder, repos }) {
  const loaded = [];
  const tried = [];
  for (const repo of repos) {
    const hub = await loadHfRepo(repo);
    loaded.push(hub);
    if (hub.status !== undefined) {
      tried.push(`${repo}: HTTP ${hub.status}${RESTRICTED.has(hub.status) ? " (gated)" : ""}`);
      continue;
    }
    const entry = findEntry(hub.files, file, folder);
    if (entry === undefined) {
      tried.push(`${hub.id}: no unique file named ${file}`);
      continue;
    }
    const oid = entry.lfs?.oid;
    if (oid === undefined) {
      tried.push(`${hub.id}: ${entry.path} is not an LFS file, so no sha256`);
      continue;
    }
    const path = entry.path.split("/").map(encodeURIComponent).join("/");
    const url = `${HF}/${hub.id}/resolve/${hub.sha}/${path}`;
    const hash = await hashOf(oid, url);
    if (hash.reason !== undefined) {
      tried.push(`${hub.id}: ${entry.path}: ${hash.reason}`);
      continue;
    }
    return { weight: hfWeight({ file, folder, repo, hub, entry, url, hash }) };
  }
  return { miss: { kind: "weight", file, folder, tried, suggestions: suggestionsFor(file, loaded) } };
}

function hfWeight({ file, folder, repo, hub, entry, url, hash }) {
  return {
    file,
    folder,
    url,
    source: `${HF}/${hub.id}`,
    bytes: entry.lfs.size ?? entry.size,
    sha256: hash.sha256,
    ...(hash.gated ? { gated: true } : {}),
    ...(COMMUNITY_REPOS.has(repo) ? { community: true } : {}),
  };
}

async function verifyReleaseAsset({ file, folder, repo }) {
  const response = await request(`https://api.github.com/repos/${repo}/releases?per_page=100`);
  if (!response.ok) {
    return { miss: { kind: "weight", file, folder, tried: [`${repo} releases: HTTP ${response.status}`], suggestions: [] } };
  }
  for (const release of await response.json()) {
    const asset = release.assets.find((candidate) => candidate.name === file);
    if (asset !== undefined) {
      const digest = typeof asset.digest === "string" ? asset.digest.replace(/^sha256:/, "") : null;
      return {
        weight: {
          file,
          folder,
          url: asset.browser_download_url,
          source: release.html_url,
          bytes: asset.size,
          sha256: digest,
          ...(digest === null ? { note: "GitHub published no digest for this asset; hash it once after the first download" } : {}),
        },
      };
    }
  }
  return { miss: { kind: "weight", file, folder, tried: [`${repo}: no release asset named ${file}`], suggestions: [] } };
}

async function commitOf(repo) {
  const { stdout } = await run("git", ["ls-remote", `https://github.com/${repo}.git`, "HEAD"], { timeout: REQUEST_TIMEOUT_MS });
  return stdout.split("\t")[0] || undefined;
}

/** True when `path` at `commit` of a GitHub repo contains `needle`. */
async function sourceContains({ repo, commit, path, contains }) {
  const response = await request(`https://raw.githubusercontent.com/${repo}/${commit}/${path}`);
  return response.ok && (await response.text()).includes(contains);
}

async function verifyNodes() {
  const packs = new Map();
  const misses = [];
  for (const candidate of NODE_CLASSES) {
    if (candidate.repo === undefined) {
      misses.push({ kind: "nodeClass", class: candidate.class, tried: [], reason: "no ComfyUI node pack found that registers this class" });
      continue;
    }
    const commit = await commitOf(candidate.repo).catch(() => undefined);
    if (commit === undefined || !(await sourceContains({ ...candidate, commit }))) {
      misses.push({ kind: "nodeClass", class: candidate.class, tried: [`${candidate.repo}: ${candidate.path} does not register ${candidate.contains}`], reason: "the pack's source does not register this class" });
      continue;
    }
    const pack = packs.get(candidate.repo) ?? { id: candidate.repo.split("/")[1], repo: `https://github.com/${candidate.repo}.git`, commit, provides: [] };
    pack.provides.push(candidate.class);
    packs.set(candidate.repo, pack);
  }
  return { nodes: [...packs.values()], misses };
}

async function verifyAutoDownloaded(nodes) {
  const entries = [];
  const misses = [];
  for (const item of AUTO_DOWNLOADED) {
    const pack = nodes.find((node) => node.repo === `https://github.com/${item.pack}.git`);
    const confirmed = pack !== undefined && (await sourceContains({ repo: item.pack, commit: pack.commit, path: item.path, contains: item.contains }));
    if (confirmed) {
      entries.push({ file: item.file, nodePack: pack.id, why: item.why, evidence: `${item.path} @ ${pack.commit} contains ${item.contains}` });
    } else {
      misses.push({ kind: "autoDownloaded", file: item.file, tried: [`${item.pack}: ${item.path}`], reason: "the pack's source does not show it fetching this file" });
    }
  }
  return { entries, misses };
}

async function main() {
  const results = [...(await Promise.all(WEIGHTS.map(verifyHfWeight))), ...(await Promise.all(RELEASE_ASSETS.map(verifyReleaseAsset)))];
  const { nodes, misses: nodeMisses } = await verifyNodes();
  const auto = await verifyAutoDownloaded(nodes);

  const weights = results.flatMap((result) => result.weight ?? []);
  const misses = [...results.flatMap((result) => result.miss ?? []), ...nodeMisses, ...auto.misses];
  await writeFile(OUTPUT, `${JSON.stringify({ weights, nodes, autoDownloaded: auto.entries, misses }, null, 2)}\n`);

  console.log(`verified ${weights.length} weights, ${nodes.length} node packs, ${auto.entries.length} auto-downloaded files`);
  for (const miss of misses) {
    console.log(`MISS ${miss.kind} ${miss.file ?? miss.class}: ${miss.tried.join("; ") || miss.reason}`);
    for (const suggestion of miss.suggestions ?? []) {
      console.log(`  similar: ${suggestion}`);
    }
  }
  console.log(`wrote ${OUTPUT}`);
}

await main().catch((error) => {
  console.error(`verify-model-sources: ${error.message}`);
  process.exitCode = 1;
});
