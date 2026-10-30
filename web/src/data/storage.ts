// Everything Kinemi keeps in your browser, and why. The Cookies page and Settings → Data & privacy both
// read this list: add an entry here whenever the code starts storing something new.

export interface StorageEntry {
  key: string;
  where: 'localStorage' | 'sessionStorage' | 'IndexedDB';
  what: string;
  why: string;
  /** how long it stays */
  keeps: string;
  /** only with accounts switched on */
  accounts?: boolean;
}

export const STORAGE: StorageEntry[] = [
  {
    key: 'kinemi.studio.v1',
    where: 'localStorage',
    what: 'Your studio: chats, renders, folders, tags, cast and the settings that go with them.',
    why: 'So your work is still here when you come back.',
    keeps: 'Until you delete it (Settings → Data & privacy) or clear your browser’s data.',
  },
  {
    key: 'kinemi.studio.v1:<account id>',
    where: 'localStorage',
    what: 'A copy of a signed-in account’s studio.',
    why: 'So the studio opens at once and keeps working offline; the account holds the real copy.',
    keeps: 'Until you sign out and delete it, delete the account, or clear your browser’s data.',
    accounts: true,
  },
  {
    key: 'kinemi.device.v1',
    where: 'localStorage',
    what: 'Settings for this browser: where renders run, the chat provider, sidebar, motion, notifications.',
    why: 'They belong to this device rather than to your studio.',
    keeps: 'Until you reset the studio or clear your browser’s data.',
  },
  {
    key: 'kinemi.secrets.v1',
    where: 'localStorage',
    what: 'The keys you bring: Comfy Cloud and OpenRouter. With “Remember keys” off, they live in sessionStorage instead and are gone when the tab closes.',
    why: 'To render and chat on your own accounts. They are only ever sent to the service they belong to.',
    keeps: 'Until you remove them (Settings → Providers) or reset the studio.',
  },
  {
    key: 'kinemi-files',
    where: 'IndexedDB',
    what: 'Images and clips you import into Assets.',
    why: 'Files are too big for localStorage.',
    keeps: 'Until you delete the asset for good, or clear your browser’s data.',
  },
  {
    key: 'kinemi.3d',
    where: 'localStorage',
    what: 'Whether the 3D models are on, off or automatic on this device.',
    why: 'Settings → Interface.',
    keeps: 'Until you change it or clear your browser’s data.',
  },
  {
    key: 'kinemi-auth',
    where: 'localStorage',
    what: 'Your sign-in session (access and refresh token).',
    why: 'To keep you signed in. Without it you would sign in on every page.',
    keeps: 'Until you sign out; a session ends by itself after a period without use.',
    accounts: true,
  },
];
