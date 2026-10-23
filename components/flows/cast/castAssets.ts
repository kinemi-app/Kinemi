/**
 * The uploaded asset names for the saved cast, kept beside the character records. lib/cast.ts owns
 * who a character is; this store only maps a character (and each of its references) to the name
 * POST /api/assets answered with, so a reload still knows what the deployment stored.
 */

/** One character's uploaded names, filed under the name it had when they were uploaded. */
export type CastAssetRecord = {
  name: string;
  refs: Record<string, string>;
};

/** Character id → its uploaded reference names. */
export type CastAssets = Record<string, CastAssetRecord>;

const CAST_ASSETS_KEY = "kinemi.cast.assets.v1";

/** Access can throw when a browser blocks storage, not just when the key is missing. */
function getStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined") {
      return undefined;
    }
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(raw: unknown): CastAssetRecord | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.trim() === "") {
    return undefined;
  }
  if (!isRecord(raw.refs)) {
    return undefined;
  }

  const refs: Record<string, string> = {};
  for (const [refId, assetName] of Object.entries(raw.refs)) {
    if (refId !== "" && typeof assetName === "string" && assetName.trim() !== "") {
      refs[refId] = assetName;
    }
  }
  return { name: raw.name, refs };
}

/** Every valid character group. A bad row or unavailable storage both read as an empty map. */
export function loadCastAssets(): CastAssets {
  const storage = getStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(CAST_ASSETS_KEY);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }

    const assets: CastAssets = {};
    for (const [characterId, entry] of Object.entries(parsed)) {
      const record = readRecord(entry);
      if (characterId !== "" && record) {
        assets[characterId] = record;
      }
    }
    return assets;
  } catch {
    return {};
  }
}

/** Persist the whole map. A full or blocked storage returns false so the UI can say so. */
export function saveCastAssets(assets: CastAssets): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(CAST_ASSETS_KEY, JSON.stringify(assets));
    return true;
  } catch {
    return false;
  }
}
