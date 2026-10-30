// Asset store actions with feedback and undo, shared by the grid, the drawer, the bulk bar and drops.
import { attachment, draftText } from '../chat/actions';
import { fileURL } from '../lib/files';
import { serverExtension } from '../lib/media';
import { toolById } from '../data/tools';
import { renderLow } from '../lib/poster';
import { plural } from '../lib/util';
import { go } from '../router';
import {
  assets,
  createFolder,
  createTag,
  deleteForever,
  duplicateAsset,
  folderById,
  folders,
  moveAssets,
  openAssetId,
  renameAsset,
  restoreAssets,
  selection,
  setDraft,
  tagById,
  tags,
  TAG_COLORS,
  toggleFavorite,
  toggleTag,
  trashAssets,
  type Asset,
} from '../store';
import { confirmDialog, promptName, type MenuItem } from '../ui/layers';
import { toast } from '../ui/toast';

const label = (ids: string[]) => (ids.length === 1 ? `“${assets.value.find((a) => a.id === ids[0])?.name ?? 'Asset'}”` : plural(ids.length, 'asset'));

export function moveTo(ids: string[], folderId: string | null) {
  const before = new Map(assets.value.filter((a) => ids.includes(a.id)).map((a) => [a.id, a.folderId]));
  moveAssets(ids, folderId);
  toast({
    title: `Moved ${label(ids)}`,
    body: folderId ? `to ${folderById(folderId)?.name}` : 'to Unsorted',
    action: { label: 'Undo', run: () => before.forEach((f, id) => moveAssets([id], f)) },
  });
}

export function tagWith(ids: string[], tagId: string, force?: boolean) {
  const on = toggleTag(ids, tagId, force);
  toast({ title: on ? `Tagged ${label(ids)}` : `Untagged ${label(ids)}`, body: `#${tagById(tagId)?.name}` });
}

export function favorite(ids: string[]) {
  const on = toggleFavorite(ids);
  toast({ title: on ? 'Added to favourites' : 'Removed from favourites', body: label(ids) });
}

export function trash(ids: string[]) {
  trashAssets(ids);
  toast({ title: `Moved ${label(ids)} to the trash`, action: { label: 'Undo', run: () => restoreAssets(ids) } });
}

export function restore(ids: string[]) {
  restoreAssets(ids);
  toast({ title: `Restored ${label(ids)}` });
}

export function destroy(ids: string[]) {
  confirmDialog(ids.length > 1 ? `Delete ${ids.length} assets for good?` : 'Delete this asset for good?', {
    body: 'This removes them from the trash. It can’t be undone.',
    cta: 'Delete forever',
    danger: true,
    onConfirm: () => {
      deleteForever(ids);
      toast({ title: `Deleted ${plural(ids.length, 'asset')}` });
    },
  });
}

export function newFolderWith(ids: string[]) {
  promptName('New folder', {
    label: 'Folder name',
    cta: ids.length ? `Create and move ${ids.length}` : 'Create folder',
    onSubmit: (name) => {
      const f = createFolder(name);
      if (ids.length) moveTo(ids, f.id);
      else toast({ title: 'Folder created', body: f.name });
    },
  });
}

export function newTagWith(ids: string[]) {
  promptName('New tag', {
    label: 'Tag name',
    cta: ids.length ? `Create and tag ${ids.length}` : 'Create tag',
    onSubmit: (name) => {
      const t = createTag(name);
      if (ids.length) tagWith(ids, t.id, true);
    },
  });
}

export function rename(a: Asset) {
  promptName('Rename asset', { label: 'Name', value: a.name, cta: 'Rename', onSubmit: (v) => renameAsset(a.id, v) });
}

export function folderItems(ids: string[]): MenuItem[] {
  const current = new Set(assets.value.filter((a) => ids.includes(a.id)).map((a) => a.folderId));
  return [
    { label: 'Unsorted', icon: 'inbox', checked: current.size === 1 && current.has(null), onSelect: () => moveTo(ids, null) },
    ...folders.value.map((f) => ({ label: f.name, icon: 'folder' as const, checked: current.size === 1 && current.has(f.id), onSelect: () => moveTo(ids, f.id) })),
    { separator: true },
    { label: 'New folder…', icon: 'folder-plus', onSelect: () => newFolderWith(ids) },
  ];
}

export function tagItems(ids: string[]): MenuItem[] {
  const list = assets.value.filter((a) => ids.includes(a.id));
  return [
    ...tags.value.map((t) => ({
      label: t.name,
      swatch: t.color,
      checked: list.length > 0 && list.every((a) => a.tagIds.includes(t.id)),
      keep: true,
      onSelect: () => tagWith(ids, t.id),
    })),
    { separator: true },
    { label: 'New tag…', icon: 'tag', onSelect: () => newTagWith(ids) },
  ];
}

export const tagColorItems = (onPick: (c: string) => void, current?: string): MenuItem[] =>
  TAG_COLORS.map((c) => ({ label: c.toUpperCase(), swatch: c, checked: c === current, onSelect: () => onPick(c) }));

/** Settings of a finished render back into its tool, to tweak and render again. */
export function openInTool(a: Asset) {
  const tool = a.tool === 'presets' ? 'cinematic' : a.tool;
  if (a.tool === 'reshoot' || a.tool === 'edit' || a.tool === 'upscale') setDraft(tool, 'source', '');
  go({ view: 'tool', tool });
}

export function sendToChat(a: Asset) {
  attachment.value = a;
  draftText.value = a.kind === 'video' ? 'Upscale this to 4K at 60 fps' : a.kind === 'still' ? 'Orbit 30° to the right, keep the subject' : '';
  go({ view: 'chat' });
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
}

/** Source tools: start Re-shoot, Edit or Upscale from this asset. */
export function useAsSource(a: Asset, tool: 'reshoot' | 'edit' | 'upscale' | 'genjutsu') {
  setDraft(tool, 'source', a.id);
  go({ view: 'tool', tool });
}

export async function download(a: Asset) {
  let url: string | null = null;
  let ext = 'png';
  if (a.file) {
    url = await fileURL(a.id);
    ext = a.file.type.split('/')[1] ?? 'bin';
  } else if (a.url) {
    url = a.url;
    ext = serverExtension(a.url, a.media, location.href);
  } else {
    const [w, h] = a.aspect.split(':').map(Number);
    const cols = 240;
    const rows = Math.round((cols * (h || 9)) / (w || 16));
    const low = renderLow({ scene: a.scene, seed: a.seed, palette: a.palette, panels: a.panels, kind: a.kind }, cols, rows);
    const out = document.createElement('canvas');
    out.width = cols * 6;
    out.height = rows * 6;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, 0, 0, out.width, out.height);
    url = out.toDataURL('image/png');
  }
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.download = `${a.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'kinemi'}.${ext}`;
  link.click();
}

/** The right-click menu of one asset (or of the selection it belongs to). */
export function assetMenu(a: Asset): MenuItem[] {
  const sel = selection.value;
  const ids = sel.includes(a.id) && sel.length > 1 ? sel : [a.id];
  const many = ids.length > 1;
  if (a.trashedAt)
    return [
      { label: many ? `Restore ${ids.length}` : 'Restore', icon: 'restore', onSelect: () => restore(ids) },
      { label: many ? `Delete ${ids.length} forever` : 'Delete forever', icon: 'trash', danger: true, onSelect: () => destroy(ids) },
    ];
  return [
    ...(many ? [{ heading: `${ids.length} selected` }] : [{ label: 'Open', icon: 'eye' as const, hint: '↵', onSelect: () => (openAssetId.value = a.id) }, { label: 'Rename…', icon: 'pencil' as const, onSelect: () => rename(a) }]),
    { label: 'Move to', icon: 'folder-move', items: folderItems(ids) },
    { label: 'Tags', icon: 'tag', items: tagItems(ids) },
    { label: a.favorite && !many ? 'Remove favourite' : 'Favourite', icon: 'star', hint: 'F', onSelect: () => favorite(ids) },
    { separator: true },
    ...(many
      ? []
      : [
          { label: `Open in ${toolById(a.tool === 'presets' ? 'cinematic' : a.tool).name}`, icon: 'tools' as const, onSelect: () => openInTool(a) },
          { label: 'Send to chat', icon: 'chat' as const, onSelect: () => sendToChat(a) },
          ...(a.kind === 'still' || a.kind === 'video' ? [{ label: 'Re-shoot an angle', icon: 'refresh' as const, onSelect: () => useAsSource(a, 'reshoot') }] : []),
          ...(a.kind === 'video' ? [{ label: 'Upscale to 4K', icon: 'sparkle' as const, onSelect: () => useAsSource(a, 'upscale') }] : []),
          { label: 'Duplicate', icon: 'copy' as const, disabled: !!a.file, onSelect: () => duplicateAsset(a.id) },
          { label: 'Download', icon: 'download' as const, onSelect: () => download(a) },
          { separator: true },
        ]),
    { label: many ? `Move ${ids.length} to trash` : 'Move to trash', icon: 'trash', hint: '⌫', danger: true, onSelect: () => trash(ids) },
  ];
}
