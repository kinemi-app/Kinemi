// Bring your own pictures and clips into the asset store. The files stay on this device (IndexedDB).
import { putFile } from '../lib/files';
import { hash, id as newId, plural } from '../lib/util';
import { addAssets, type Asset } from '../store';
import { toast } from '../ui/toast';

function size(file: File): Promise<[number, number]> {
  if (file.type.startsWith('image/')) {
    return createImageBitmap(file)
      .then((b) => {
        const s: [number, number] = [b.width, b.height];
        b.close();
        return s;
      })
      .catch(() => [16, 9]);
  }
  if (file.type.startsWith('video/')) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        resolve([v.videoWidth || 16, v.videoHeight || 9]);
        URL.revokeObjectURL(url);
      };
      v.onerror = () => resolve([16, 9]);
      v.src = url;
    });
  }
  return Promise.resolve([16, 9]);
}

function duration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const m = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    m.preload = 'metadata';
    m.onloadedmetadata = () => {
      resolve(Number.isFinite(m.duration) ? Math.round(m.duration) : undefined);
      URL.revokeObjectURL(url);
    };
    m.onerror = () => resolve(undefined);
    m.src = url;
  });
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export async function importFiles(files: File[], folderId: string | null = null): Promise<Asset[]> {
  const ok = files.filter((f) => /^(image|video|audio)\//.test(f.type));
  if (ok.length < files.length) toast({ title: 'Some files were skipped', body: 'Images, video and audio only.' });
  if (!ok.length) return [];
  const made: Asset[] = [];
  for (const f of ok) {
    const id = newId('a');
    try {
      await putFile(id, f);
    } catch {
      toast({ title: 'Couldn’t store that file', body: f.name });
      continue;
    }
    const [w, h] = await size(f);
    const g = gcd(w, h) || 1;
    const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'still';
    made.push({
      id,
      name: f.name.replace(/\.[^.]+$/, ''),
      kind,
      // the tool you'd most likely take it to next
      tool: kind === 'video' ? 'edit' : kind === 'audio' ? 'audio' : 'reshoot',
      folderId,
      tagIds: [],
      favorite: false,
      createdAt: Date.now(),
      aspect: `${w / g}:${h / g}`,
      duration: await duration(f),
      scene: kind === 'audio' ? 'audio' : 'neon',
      seed: hash(f.name),
      source: 'import',
      file: { type: f.type, size: f.size },
    });
  }
  addAssets(made);
  if (made.length) toast({ title: `Imported ${plural(made.length, 'file')}`, body: 'Saved on this device, in the asset store.' });
  return made;
}
