// Accounts: sign up, sign in, passwords, email, sign out and deleting the account, on Supabase Auth.
// The sign-in pages and Settings → Account call these; the studio calls startAccounts() once it loads.
import type { AuthError, Session, User } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, BASE, CLOUD, GUESTS, type Provider } from '../deploy';
import { account, authReady, type Account } from './session';
import { BUCKET, supabase } from './supabase';

const abs = (path: string) => new URL(path, location.origin).href;

/** Only paths on this site: a `next` from the URL can't send anyone elsewhere. */
export function safeNext(next: string | null | undefined, fallback = `${BASE}app/`) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}

export function toAccount(u: User): Account {
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const email = u.email ?? '';
  return {
    id: u.id,
    email,
    name: String(meta.name || meta.full_name || meta.user_name || email.split('@')[0] || 'Director'),
    provider: String(u.app_metadata?.provider ?? 'email'),
    pendingEmail: u.new_email || undefined,
  };
}

/** Supabase's errors in plain words. */
export function friendly(e: unknown): Error {
  const err = e as Partial<AuthError> & { message?: string };
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  const say: Record<string, string> = {
    invalid_credentials: 'That email and password don’t match an account.',
    email_not_confirmed: 'Confirm your email first: the link is in your inbox.',
    user_already_exists: 'There’s already an account with that email. Sign in instead.',
    email_exists: 'There’s already an account with that email.',
    weak_password: 'Pick a longer password: at least 8 characters, ideally a few words.',
    same_password: 'That’s the password you have now. Pick a new one.',
    over_email_send_rate_limit: 'Too many emails in a short time. Wait a minute and try again.',
    over_request_rate_limit: 'Too many tries in a short time. Wait a minute and try again.',
    email_address_invalid: 'That email address doesn’t look right.',
    signup_disabled: 'New accounts are switched off here.',
    reauthentication_needed: 'For safety, sign out and in again, then change it.',
    otp_expired: 'That link has expired. Ask for a new one.',
    session_not_found: 'You were signed out. Sign in again.',
  };
  const out = (text: string) => Object.assign(new Error(text), { code });
  if (say[code]) return out(say[code]);
  if (/fetch|network/i.test(msg)) return out('Couldn’t reach the account service. Check your connection.');
  return out(msg || 'Something went wrong. Try again.');
}

type Ok<R> = Extract<R, { error: null }> extends never ? R : Extract<R, { error: null }>;

/** Run a Supabase call; its error becomes a thrown Error in plain words. */
async function call<R extends { data: unknown; error: AuthError | null }>(fn: () => Promise<R>): Promise<Ok<R>['data']> {
  let res: R;
  try {
    res = await fn();
  } catch (e) {
    throw friendly(e);
  }
  if (res.error) throw friendly(res.error);
  return res.data as Ok<R>['data'];
}

export async function signUp(o: { name: string; email: string; password: string; next?: string }) {
  const sb = await supabase();
  const data = await call(() => sb.auth.signUp({ email: o.email.trim(), password: o.password, options: { data: { name: o.name.trim() }, emailRedirectTo: abs(safeNext(o.next)) } }));
  // with “Confirm email” on (Supabase's default) there's no session until the link is opened
  return { needsConfirm: !data.session };
}

export async function resendConfirm(email: string, next?: string) {
  const sb = await supabase();
  await call(() => sb.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: abs(safeNext(next)) } }));
}

export async function signIn(email: string, password: string) {
  const sb = await supabase();
  await call(() => sb.auth.signInWithPassword({ email: email.trim(), password }));
}

export async function signInWith(provider: Provider, next?: string) {
  const sb = await supabase();
  await call(() => sb.auth.signInWithOAuth({ provider, options: { redirectTo: abs(safeNext(next)) } }));
}

/** Send a reset link. Says the same whether or not the email has an account. */
export async function sendReset(email: string) {
  const sb = await supabase();
  try {
    await call(() => sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: abs(`${BASE}reset-password/`) }));
  } catch (e) {
    if (/rate|too many/i.test((e as Error).message)) throw e;
  }
}

export async function setPassword(password: string) {
  const sb = await supabase();
  await call(() => sb.auth.updateUser({ password }));
}

export async function updateName(name: string) {
  const sb = await supabase();
  const data = await call(() => sb.auth.updateUser({ data: { name: name.trim() } }));
  if (data.user) account.value = toAccount(data.user);
}

/** Change the email: Supabase sends a link to the new address (and, by default, the old one too). */
export async function changeEmail(email: string) {
  const sb = await supabase();
  const data = await call(() => sb.auth.updateUser({ email: email.trim() }, { emailRedirectTo: abs(`${BASE}app/settings/account/`) }));
  if (data.user) account.value = toAccount(data.user);
}

export async function signOut(everywhere = false) {
  const sb = await supabase();
  await call(async () => ({ data: null, ...(await sb.auth.signOut({ scope: everywhere ? 'global' : 'local' })) }));
}

/** Delete the account: its files, then the user (the studio's rows go with it), then sign out here. */
export async function deleteAccount() {
  const sb = await supabase();
  const me = account.value;
  if (!me) return;
  const files = await sb.storage.from(BUCKET).list(me.id, { limit: 1000 });
  const paths = (files.data ?? []).map((f) => `${me.id}/${f.name}`);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw new Error(/function|not found|does not exist/i.test(error.message) ? 'The account service is missing delete_my_account(): run supabase/schema.sql in your Supabase project.' : friendly(error).message);
  // stop syncing first, so nothing writes the deleted account's studio back into this browser
  const { stopSync } = await import('./sync');
  stopSync({ toGuest: GUESTS });
  try {
    for (const k of Object.keys(localStorage)) if (k.endsWith(`:${me.id}`)) localStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
  await sb.auth.signOut({ scope: 'local' });
}

export async function currentSession(): Promise<Session | null> {
  if (!CLOUD) return null;
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  return data.session;
}

/** The account this browser was last signed in to, read straight from the stored session, so the studio can
 *  open that account's copy at once instead of flashing the guest's. Checked properly by startAccounts. */
export function storedAccount(): Account | null {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null');
    return s?.user?.id ? toAccount(s.user as User) : null;
  } catch {
    return null;
  }
}

/** Watch the session in the studio: sign-ins, sign-outs, refreshed tokens and profile changes. */
export async function startAccounts(onChange: (next: Account | null, prev: Account | null) => void) {
  if (!CLOUD) return;
  let sb;
  try {
    sb = await supabase();
  } catch {
    authReady.value = true;
    return;
  }
  const apply = (session: Session | null) => {
    const prev = account.value;
    const next = session?.user ? toAccount(session.user) : null;
    if (next?.id === prev?.id && JSON.stringify(next) === JSON.stringify(prev)) return;
    account.value = next;
    if (next?.id !== prev?.id) onChange(next, prev);
  };
  const { data } = await sb.auth.getSession();
  apply(data.session);
  authReady.value = true;
  // Supabase asks not to call it from inside this callback: hand the work to the next task
  sb.auth.onAuthStateChange((_event, session) => setTimeout(() => apply(session), 0));
}

/** Where someone without a session goes when signing in is required. */
export const signInHref = (next = location.pathname + location.search) => `${BASE}signin/?next=${encodeURIComponent(next)}`;

export const accountsRequired = CLOUD && !GUESTS;
