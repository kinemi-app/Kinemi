/** One reference image stored inline as a data URL, so it survives a reload. */
export type CastRef = {
  id: string;
  name: string;
  dataUrl: string;
};

/** A cast member: a name, its reference images and the emotions it can play. */
export type CastCharacter = {
  id: string;
  name: string;
  refs: CastRef[];
  emotions: string[];
  createdAt: number;
};

const CAST_STORAGE_KEY = "kinemi.cast.v1";

let fallbackSequence = 0;

/** randomUUID needs a secure context; the fallback only has to be unique inside one browser. */
function createCharacterId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackSequence += 1;
  return `cast-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function readRef(raw: unknown): CastRef | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !isNonEmptyString(raw.dataUrl)) {
    return undefined;
  }
  return { id: raw.id, name: raw.name, dataUrl: raw.dataUrl };
}

function readCharacter(raw: unknown): CastCharacter | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) {
    return undefined;
  }
  if (typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt)) {
    return undefined;
  }
  if (!Array.isArray(raw.refs) || !Array.isArray(raw.emotions)) {
    return undefined;
  }

  const refs: CastRef[] = [];
  for (const entry of raw.refs) {
    const ref = readRef(entry);
    if (!ref) {
      return undefined;
    }
    refs.push(ref);
  }

  const emotions: string[] = [];
  for (const entry of raw.emotions) {
    if (!isNonEmptyString(entry)) {
      return undefined;
    }
    emotions.push(entry);
  }

  return { id: raw.id, name: raw.name, refs, emotions, createdAt: raw.createdAt };
}

/** Every valid saved character. A bad row or unavailable storage both read as an empty list. */
export function loadCast(): CastCharacter[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(CAST_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const characters: CastCharacter[] = [];
    for (const row of parsed) {
      const character = readCharacter(row);
      if (character) {
        characters.push(character);
      }
    }
    return characters;
  } catch {
    return [];
  }
}

/** Persist the whole cast. A full or blocked storage returns false so the UI can say so. */
export function saveCast(list: CastCharacter[]): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(CAST_STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** A fresh cast member; the caller supplies refs that are already data URLs. */
export function newCharacter(name: string, refs: CastRef[], emotions: string[]): CastCharacter {
  return {
    id: createCharacterId(),
    name: name.trim(),
    refs,
    emotions: [...emotions],
    createdAt: Date.now(),
  };
}
