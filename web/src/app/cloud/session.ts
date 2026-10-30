// Who is signed in, and how the account's studio is syncing. Nothing here loads Supabase:
// the studio's shell reads these on every page, with or without accounts.
import { signal } from '@preact/signals';
import { CLOUD } from '../deploy';

export interface Account {
  id: string;
  email: string;
  name: string;
  /** how they signed in: email, google, github… */
  provider: string;
  /** an email change waiting for its confirmation link */
  pendingEmail?: string;
}

export const account = signal<Account | null>(null);

/** The session has been checked. Without accounts there is nothing to check. */
export const authReady = signal(!CLOUD);

export type SyncState = 'off' | 'loading' | 'saving' | 'saved' | 'offline' | 'error';

export const syncState = signal<SyncState>('off');
/** what went wrong, when syncState is 'error' */
export const syncError = signal('');
/** when the account's studio was last saved to the server */
export const syncedAt = signal<number | null>(null);

export const SYNC_LABEL: Record<SyncState, string> = {
  off: 'Not syncing',
  loading: 'Loading your studio…',
  saving: 'Saving…',
  saved: 'Saved to your account',
  offline: 'Offline · will retry',
  error: 'Sync stopped',
};
