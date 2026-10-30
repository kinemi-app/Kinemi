// Settings → Account: your name on this computer, or your account: profile, email, password, signing
// out and deleting it.
import { useEffect, useState } from 'preact/hooks';
import { secrets, forgetComfyKey, forgetRouterKey } from '../compute';
import { BASE, CLOUD, GUESTS } from '../deploy';
import { ago } from '../lib/util';
import { patchSettings, settings } from '../store';
import { Avatar, PxIcon } from '../ui/icons';
import { openDialog } from '../ui/layers';
import { toast } from '../ui/toast';
import { changeEmail, deleteAccount, setPassword, signOut, updateName } from '../cloud/auth';
import { account, SYNC_LABEL, syncedAt, syncError, syncState } from '../cloud/session';
import { syncNow } from '../cloud/sync';
import { Card, Chip, Row } from './parts';

const here = () => (typeof location === 'undefined' ? `${BASE}app/settings/account/` : location.pathname);

function NameRow({ value, onSave, desc }: { value: string; onSave: (v: string) => Promise<void> | void; desc: string }) {
  const [name, setName] = useState(value);
  const [busy, setBusy] = useState(false);
  // the saved name arrives after the page is drawn
  useEffect(() => setName(value), [value]);
  const dirty = name.trim() !== value && !!name.trim();
  return (
    <Row label="Your name" desc={desc} stack>
      <form
        class="set-inline"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!dirty) return;
          setBusy(true);
          try {
            await onSave(name.trim());
            toast({ title: 'Name saved', body: name.trim() });
          } catch (err) {
            toast({ title: 'Not saved', body: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <span class="set-avatar">
          <Avatar name={name.trim() || 'Guest'} size={36} />
        </span>
        <label class="sr-only" for="your-name">
          Your name
        </label>
        <input id="your-name" class="input" value={name} maxLength={60} autoComplete="name" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} placeholder="How Kinemi greets you" />
        <button type="submit" class="btn btn-sm btn-ghost" disabled={!dirty || busy}>
          Save
        </button>
      </form>
    </Row>
  );
}

function LocalAccount() {
  const s = settings.value;
  return (
    <>
      <Card id="you" title="On this computer" desc="This Kinemi runs without accounts. Everything you make stays in this browser, on this computer.">
        <NameRow value={s.name} onSave={(v) => void patchSettings({ name: v })} desc="Shown in the sidebar. It never leaves this browser." />
        <p class="set-help">
          <PxIcon name="shield" size={12} /> Back your studio up now and then: Settings → Data & privacy → Export the studio.
        </p>
        <p class="set-help">
          <PxIcon name="info" size={12} /> Running Kinemi for other people? Accounts switch on with two settings, your Supabase project’s address and its publishable key: see “Publish the web version” in the README.
        </p>
      </Card>
    </>
  );
}

function GuestAccount() {
  const s = settings.value;
  const next = encodeURIComponent(here());
  return (
    <>
      <Card id="guest" title="You’re a guest" desc="As a guest, your work is saved in this browser only. With an account it’s saved to your account and follows you to any device.">
        <div class="set-actions">
          <a class="btn btn-sm btn-accent" href={`${BASE}signup/?next=${next}`}>
            Create an account
          </a>
          <a class="btn btn-sm btn-ghost" href={`${BASE}signin/?next=${next}`}>
            Sign in
          </a>
        </div>
        <p class="set-help">When you sign up, Kinemi offers to bring what you made here into the new account.</p>
      </Card>
      <Card id="you" title="Your name">
        <NameRow value={s.name} onSave={(v) => void patchSettings({ name: v })} desc="Shown in the sidebar while you’re a guest." />
      </Card>
    </>
  );
}

function SignOutDialog({ close, everywhere }: { close: () => void; everywhere: boolean }) {
  const [forget, setForget] = useState(false);
  const hasKeys = !!(secrets.value.comfyKey || secrets.value.openrouterKey);
  return (
    <div class="form">
      <p class="dialog-text">
        {everywhere ? 'You’ll be signed out on every device, this one included.' : 'Your studio stays in your account.'} {GUESTS ? 'This browser goes back to its guest studio.' : ''}
      </p>
      {hasKeys && (
        <label class="set-check">
          <input type="checkbox" checked={forget} onChange={(e) => setForget((e.currentTarget as HTMLInputElement).checked)} />
          <span>Also remove the keys I brought (Comfy Cloud, OpenRouter) from this browser</span>
        </label>
      )}
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          autofocus
          onClick={async () => {
            if (forget) {
              forgetComfyKey();
              forgetRouterKey();
            }
            close();
            try {
              await signOut(everywhere);
            } catch (e) {
              toast({ title: 'Couldn’t sign out', body: (e as Error).message });
            }
          }}
        >
          <PxIcon name="logout" size={13} />
          Sign out
        </button>
      </div>
    </div>
  );
}

function DeleteDialog({ close }: { close: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      class="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (typed !== 'DELETE') return;
        setBusy(true);
        try {
          await deleteAccount();
          close();
          toast({ title: 'Your account is deleted', body: 'With every render, chat and file in it.' });
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <p class="dialog-text">Your account goes, with every render, chat, folder, tag, cast member and imported file in it, on every device. This can’t be undone. Export the studio first if you want a copy.</p>
      <label class="field">
        <span class="field-label">Type DELETE to confirm</span>
        <input class="input mono" value={typed} autoComplete="off" spellcheck={false} onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} autofocus />
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button type="submit" class="btn btn-danger" disabled={typed !== 'DELETE' || busy}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </form>
  );
}

function PasswordRow() {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Row label="Password" desc="At least 8 characters. A few words in a row is easy to remember and hard to guess." stack>
      <form
        class="set-grid2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8) return setError('At least 8 characters.');
          if (pw !== again) return setError('The two don’t match.');
          setError('');
          setBusy(true);
          try {
            await setPassword(pw);
            setPw('');
            setAgain('');
            toast({ title: 'Password changed', body: 'Use the new one next time you sign in.' });
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input type="text" autoComplete="username" value={account.value?.email} class="sr-only" tabIndex={-1} aria-hidden="true" readOnly />
        <label class="sr-only" for="new-password">
          New password
        </label>
        <input id="new-password" class="input" type="password" autoComplete="new-password" placeholder="New password" value={pw} onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)} />
        <label class="sr-only" for="new-password-2">
          The new password again
        </label>
        <input id="new-password-2" class="input" type="password" autoComplete="new-password" placeholder="Once more" value={again} onInput={(e) => setAgain((e.currentTarget as HTMLInputElement).value)} />
        <button type="submit" class="btn btn-sm btn-ghost" disabled={!pw || busy}>
          Change password
        </button>
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Row>
  );
}

function EmailRow() {
  const me = account.value!;
  const [email, setEmail] = useState(me.email);
  const [busy, setBusy] = useState(false);
  const dirty = email.trim().toLowerCase() !== me.email.toLowerCase() && /.+@.+\..+/.test(email.trim());
  return (
    <Row label="Email" desc={me.pendingEmail ? `Waiting for you to confirm ${me.pendingEmail}: the link is in that inbox.` : 'Changing it sends a confirmation link to the new address.'} stack>
      <form
        class="set-inline"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!dirty) return;
          setBusy(true);
          try {
            await changeEmail(email);
            toast({ title: 'Check your inbox', body: `Open the link we sent to ${email.trim()} to finish.` });
          } catch (err) {
            toast({ title: 'Not changed', body: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label class="sr-only" for="account-email">
          Email
        </label>
        <input id="account-email" class="input" type="email" autoComplete="email" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
        <button type="submit" class="btn btn-sm btn-ghost" disabled={!dirty || busy}>
          Change email
        </button>
      </form>
    </Row>
  );
}

function SignedIn() {
  const me = account.value!;
  const st = syncState.value;
  const tone = st === 'saved' ? 'ok' : st === 'error' ? 'bad' : st === 'offline' ? 'warn' : 'muted';
  return (
    <>
      <Card id="profile" title="Profile" aside={<Chip tone="info">{me.provider === 'email' ? 'Email and password' : `Signed in with ${me.provider[0].toUpperCase()}${me.provider.slice(1)}`}</Chip>}>
        <NameRow value={me.name} onSave={updateName} desc="Shown in the sidebar and in emails from Kinemi." />
        <EmailRow />
        {me.provider === 'email' && <PasswordRow />}
      </Card>
      <Card id="sync" title="Your studio, everywhere" desc="Your renders, chats, folders, tags, cast and settings are saved to your account and come along to every device you sign in on.">
        <Row label={<Chip tone={tone}>{SYNC_LABEL[st]}</Chip>} desc={st === 'error' ? syncError.value : syncedAt.value ? `Last saved ${ago(syncedAt.value)}.` : 'Saved a second or so after each change.'}>
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => void syncNow()}>
            <PxIcon name="refresh" size={12} />
            Sync now
          </button>
        </Row>
        <p class="set-help">
          <PxIcon name="lock" size={12} /> The keys you bring are the exception: they stay in each browser and never go to your account.
        </p>
      </Card>
      <Card id="session" title="Signing out">
        <div class="set-actions">
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => openDialog({ title: 'Sign out?', body: (close) => <SignOutDialog close={close} everywhere={false} /> })}>
            <PxIcon name="logout" size={12} />
            Sign out
          </button>
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => openDialog({ title: 'Sign out everywhere?', body: (close) => <SignOutDialog close={close} everywhere /> })}>
            Sign out on every device
          </button>
        </div>
      </Card>
      <Card id="delete" title="Delete your account" desc="Removes the account and everything in it, for good." class="is-danger">
        <div class="set-actions">
          <button type="button" class="btn btn-sm btn-danger" onClick={() => openDialog({ title: 'Delete your account?', body: (close) => <DeleteDialog close={close} /> })}>
            Delete my account…
          </button>
        </div>
      </Card>
    </>
  );
}

export function AccountSection() {
  if (!CLOUD) return <LocalAccount />;
  if (!account.value) return <GuestAccount />;
  return <SignedIn />;
}
