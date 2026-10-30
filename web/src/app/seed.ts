// A first-visit studio: two cast members and nothing else. Assets, folders, tags and chats are only ever
// the owner's own. Ids are fixed so the server render and the browser agree.
import type { Asset, Character, Chat, Folder, Tag } from './store';

const NOW = Date.now();
const at = (hours: number) => NOW - Math.round(hours * 3_600_000);

const cast: Character[] = [
  { id: 'c-mara', name: 'Mara', tag: 'mara', look: 'Late twenties, cropped silver hair, yellow raincoat', locked: true, seed: 1207, createdAt: at(70) },
  { id: 'c-ilo', name: 'Ilo', tag: 'ilo', look: 'Early twenties, long braids, oversized denim jacket', locked: true, seed: 5521, createdAt: at(72) },
];

const assets: Asset[] = [];
const folders: Folder[] = [];
const tags: Tag[] = [];
const chats: Chat[] = [];

export const SEED = { folders, tags, cast, assets, chats };
