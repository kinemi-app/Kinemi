// Back up the studio as one .json file, and bring a backup back. A backup never holds the keys you bring.
import { getFile, putFile } from '../lib/files';
import { snapshot, studioKey, switchStudio, type StudioData } from '../store';

interface Backup extends StudioData {
  kinemi: 'studio';
  v: 1;
  exportedAt: string;
  /** imported images and clips, base64, by asset id */
  files?: Record<string, { type: string; data: string }>;
}

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function fromBase64(data: string, type: string) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The whole studio as a file, with the imported files inside it if asked. */
export async function exportStudio(withFiles: boolean) {
  const data: Backup = { kinemi: 'studio', v: 1, exportedAt: new Date().toISOString(), ...snapshot() };
  if (withFiles) {
    data.files = {};
    for (const a of data.assets.filter((x) => x.file)) {
      const blob = await getFile(a.id).catch(() => null);
      if (blob) data.files[a.id] = { type: blob.type || a.file!.type, data: await toBase64(blob) };
    }
  }
  const name = `kinemi-studio-${data.exportedAt.slice(0, 10)}.json`;
  download(name, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  return name;
}

export type ImportResult = { ok: true; assets: number; chats: number; files: number } | { ok: false; error: string };

/** Replace the studio on screen with a backup. This browser's settings and keys stay as they are. */
export async function importStudio(file: File): Promise<ImportResult> {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'That file isn’t a Kinemi backup: it isn’t JSON.' };
  }
  if (data?.kinemi !== 'studio' || !Array.isArray(data.assets) || !Array.isArray(data.chats)) return { ok: false, error: 'That file isn’t a Kinemi studio backup.' };
  let files = 0;
  for (const [id, f] of Object.entries(data.files ?? {})) {
    try {
      await putFile(id, fromBase64(f.data, f.type));
      files += 1;
    } catch {
      /* a file that won't decode is skipped; its asset shows its poster instead */
    }
  }
  const { files: _files, kinemi: _k, v: _v, exportedAt: _at, ...studio } = data;
  switchStudio(studioKey(), studio);
  return { ok: true, assets: data.assets.length, chats: data.chats.length, files };
}
