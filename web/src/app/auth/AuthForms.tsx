// Sign in, sign up, forgot and reset password: one island for the four pages. Each form talks to
// Supabase Auth through cloud/auth.ts. Without accounts (the copy on your own computer) it says so.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BASE, CLOUD, GUESTS, PROVIDERS, type Provider } from '../deploy';
import { resendConfirm, safeNext, sendReset, setPassword, signIn, signInWith, signUp } from '../cloud/auth';
import { supabase } from '../cloud/supabase';
import { LEGAL, policyUrl } from '../../data/legal';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', github: 'GitHub', apple: 'Apple', discord: 'Discord', gitlab: 'GitLab' };

/** Where to go afterwards, from ?next=, only ever a path on this site. */
function useNext() {
  const [next, setNext] = useState(`${BASE}app/`);
  useEffect(() => setNext(safeNext(new URLSearchParams(location.search).get('next'))), []);
  return next;
}

const withNext = (path: string, next: string) => (next === `${BASE}app/` ? path : `${path}?next=${encodeURIComponent(next)}`);

function Card({ title, sub, children }: { title: string; sub?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="auth-card">
      <div>
        <h1>{title}</h1>
      </div>
      {sub && <p class="auth-sub">{sub}</p>}
      {children}
    </div>
  );
}

function Field({ label, aside, children, id }: { label: string; aside?: ComponentChildren; children: ComponentChildren; id: string }) {
  return (
    <div class="pg-field">
      <span class="pg-label">
        <label for={id}>{label}</label>
        {aside}
      </span>
      {children}
    </div>
  );
}

function Password({ id, value, set, autoComplete, placeholder }: { id: string; value: string; set: (v: string) => void; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <span class="pg-input-wrap">
      <input id={id} class="pg-input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} placeholder={placeholder} required onInput={(e) => set((e.currentTarget as HTMLInputElement).value)} />
      <button type="button" class="pg-reveal" aria-pressed={show} aria-label={show ? 'Hide the password' : 'Show the password'} onClick={() => setShow(!show)}>
        {show ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}

function ErrorLine({ text }: { text: string }) {
  return text ? (
    <p class="pg-error" role="alert">
      {text}
    </p>
  ) : null;
}

function Providers({ next }: { next: string }) {
  const [error, setError] = useState('');
  if (!PROVIDERS.length) return null;
  return (
    <>
      <div class="auth-providers">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            class="pg-btn pg-btn-ghost pg-btn-block"
            onClick={() => signInWith(p, next).catch((e: Error) => setError(e.message))}
          >
            Continue with {PROVIDER_NAME[p]}
          </button>
        ))}
      </div>
      <ErrorLine text={error} />
      <div class="auth-or">or with email</div>
    </>
  );
}

/** How strong a password looks: 0 to 4. Length counts most. */
function strength(pw: string) {
  if (!pw) return 0;
  let score = pw.length >= 8 ? 1 : 0;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16 || /\s/.test(pw.trim())) score += 1;
  if (/[a-z]/i.test(pw) && /[^a-z]/i.test(pw)) score += 1;
  return Math.max(1, Math.min(4, score));
}

function NoAccounts() {
  return (
    <Card title="No accounts here" sub="This copy of Kinemi runs on your own computer, without accounts. Everything you make stays in this browser.">
      <a class="pg-btn pg-btn-green pg-btn-block" href={`${BASE}app/`}>
        Open the studio
      </a>
      <p class="pg-note">Running Kinemi for other people? Accounts switch on with your Supabase project’s address and publishable key: see “Publish the web version” in the README.</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function SignIn() {
  const next = useNext();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Welcome back" sub="Sign in to your studio.">
      <Providers next={next} />
      <form
        class="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await signIn(email, pw);
            location.assign(next);
          } catch (err) {
            setError((err as Error).message);
            setUnconfirmed((err as { code?: string }).code === 'email_not_confirmed');
            setBusy(false);
          }
        }}
      >
        <Field id="email" label="Email">
          <input id="email" class="pg-input" type="email" autoComplete="email" required value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field id="password" label="Password" aside={<a href={`${BASE}forgot-password/`}>Forgot it?</a>}>
          <Password id="password" value={pw} set={setPw} autoComplete="current-password" />
        </Field>
        <ErrorLine text={error} />
        {unconfirmed && (
          <button
            type="button"
            class="pg-btn pg-btn-ghost pg-btn-sm"
            disabled={resent}
            onClick={async () => {
              try {
                await resendConfirm(email, next);
                setResent(true);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {resent ? 'Sent. Check your inbox' : 'Send the confirmation link again'}
          </button>
        )}
        <button type="submit" class="pg-btn pg-btn-primary pg-btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p class="auth-alt">
        New to Kinemi? <a href={withNext(`${BASE}signup/`, next)}>Create an account</a>
      </p>
      {GUESTS && (
        <a class="auth-guest" href={`${BASE}app/`}>
          Continue as a guest →
        </a>
      )}
    </Card>
  );
}

function SignUp() {
  const next = useNext();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const level = strength(pw);
  const rules = [
    { ok: pw.length >= 8, text: 'At least 8 characters' },
    { ok: pw.length >= 12 || /\s/.test(pw.trim()), text: 'Longer is stronger: a few words in a row is easy to remember' },
    { ok: !!pw && !!email && !pw.toLowerCase().includes(email.split('@')[0].toLowerCase()), text: 'Not your email address' },
  ];

  if (sent)
    return (
      <Card title="Check your inbox" sub={<>We sent a link to <b>{email}</b>. Open it to finish creating your account.</>}>
        <div class="auth-done">
          <span class="auth-mail" aria-hidden="true">
            <svg viewBox="0 0 9 9" width="26" height="26" shape-rendering="crispEdges">
              <path d="M0 1h9v7H0zM1 2v5h7V2zM2 3h1v1H2zM6 3h1v1H6zM3 4h1v1H3zM5 4h1v1H5zM4 5h1v1H4z" fill="currentColor" fill-rule="evenodd" />
            </svg>
          </span>
          <p class="pg-note">No email after a few minutes? Look in your spam folder, or send it again.</p>
          <button
            type="button"
            class="pg-btn pg-btn-ghost"
            disabled={resent}
            onClick={async () => {
              try {
                await resendConfirm(email, next);
                setResent(true);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {resent ? 'Sent again' : 'Send it again'}
          </button>
          <ErrorLine text={error} />
          <button
            type="button"
            class="pg-btn pg-btn-ghost"
            onClick={() => {
              setSent(false);
              setResent(false);
            }}
          >
            Use a different email
          </button>
        </div>
      </Card>
    );

  return (
    <Card title="Create your account" sub="Your studio, saved to your account and on every device you sign in on.">
      <Providers next={next} />
      <form
        class="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8) return setError('Pick a password of at least 8 characters.');
          if (!agree) return setError(`Please confirm you’re ${LEGAL.minimumAge} or older and accept the Terms.`);
          setBusy(true);
          setError('');
          try {
            const r = await signUp({ name, email, password: pw, next });
            if (r.needsConfirm) setSent(true);
            else location.assign(next);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="name" label="Your name">
          <input id="name" class="pg-input" autoComplete="name" required maxLength={60} value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field id="email" label="Email">
          <input id="email" class="pg-input" type="email" autoComplete="email" required value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field id="password" label="Password">
          <Password id="password" value={pw} set={setPw} autoComplete="new-password" />
          <span class="auth-meter" data-level={level} aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <i key={n} class={n <= level ? 'on' : undefined} />
            ))}
          </span>
          <ul class="auth-rules" aria-label="Password tips">
            {rules.map((r) => (
              <li key={r.text} class={r.ok ? 'ok' : undefined}>
                {r.text}
              </li>
            ))}
          </ul>
        </Field>
        <label class="pg-check">
          <input type="checkbox" checked={agree} aria-required="true" onChange={(e) => setAgree((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            I’m {LEGAL.minimumAge} or older and I accept the{' '}
            <a href={policyUrl('terms')} target="_blank" rel="noopener">
              Terms of Service
            </a>{' '}
            and the{' '}
            <a href={policyUrl('acceptable-use')} target="_blank" rel="noopener">
              Acceptable Use Policy
            </a>
            .
          </span>
        </label>
        <p class="pg-note">
          How we handle your data: the{' '}
          <a href={policyUrl('privacy')} target="_blank" rel="noopener">
            Privacy Policy
          </a>
          .
        </p>
        <ErrorLine text={error} />
        <button type="submit" class="pg-btn pg-btn-green pg-btn-block" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
      <p class="auth-alt">
        Have an account? <a href={withNext(`${BASE}signin/`, next)}>Sign in</a>
      </p>
      {GUESTS && (
        <a class="auth-guest" href={`${BASE}app/`}>
          Continue as a guest →
        </a>
      )}
    </Card>
  );
}

function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (sent)
    return (
      <Card title="Check your inbox" sub={<>If there’s an account for <b>{email}</b>, a link to set a new password is on its way.</>}>
        <p class="pg-note">The link works once and expires after a while. Nothing there after a few minutes? Look in your spam folder.</p>
        <a class="pg-btn pg-btn-ghost pg-btn-block" href={`${BASE}signin/`}>
          Back to sign in
        </a>
      </Card>
    );
  return (
    <Card title="Forgot your password?" sub="Tell us your email and we’ll send a link to set a new one.">
      <form
        class="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await sendReset(email);
            setSent(true);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="email" label="Email">
          <input id="email" class="pg-input" type="email" autoComplete="email" required value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <ErrorLine text={error} />
        <button type="submit" class="pg-btn pg-btn-primary pg-btn-block" disabled={busy}>
          {busy ? 'Sending…' : 'Send the link'}
        </button>
      </form>
      <p class="auth-alt">
        Remembered it? <a href={`${BASE}signin/`}>Sign in</a>
      </p>
    </Card>
  );
}

function Reset() {
  const [state, setState] = useState<'checking' | 'ready' | 'expired' | 'done'>('checking');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // the link from the email carries the session in the address; Supabase picks it up from there
    const failed = /error_code=|error=/.test(location.hash);
    supabase()
      .then((sb) => sb.auth.getSession())
      .then(({ data }) => setState(!failed && data.session ? 'ready' : 'expired'))
      .catch(() => setState('expired'));
  }, []);
  if (state === 'checking')
    return (
      <Card title="Set a new password">
        <p class="pg-note">Opening your link…</p>
      </Card>
    );
  if (state === 'expired')
    return (
      <Card title="This link has expired" sub="Reset links work once, for a limited time. Ask for a new one.">
        <a class="pg-btn pg-btn-primary pg-btn-block" href={`${BASE}forgot-password/`}>
          Send a new link
        </a>
      </Card>
    );
  if (state === 'done')
    return (
      <Card title="Password changed" sub="You’re signed in with the new one.">
        <a class="pg-btn pg-btn-green pg-btn-block" href={`${BASE}app/`}>
          Open the studio
        </a>
      </Card>
    );
  return (
    <Card title="Set a new password" sub="At least 8 characters. A few words in a row is easy to remember and hard to guess.">
      <form
        class="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8) return setError('At least 8 characters.');
          if (pw !== again) return setError('The two passwords don’t match.');
          setBusy(true);
          setError('');
          try {
            await setPassword(pw);
            history.replaceState(null, '', location.pathname);
            setState('done');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="password" label="New password">
          <Password id="password" value={pw} set={setPw} autoComplete="new-password" />
        </Field>
        <Field id="password2" label="Once more">
          <Password id="password2" value={again} set={setAgain} autoComplete="new-password" />
        </Field>
        <ErrorLine text={error} />
        <button type="submit" class="pg-btn pg-btn-primary pg-btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save the new password'}
        </button>
      </form>
    </Card>
  );
}

export default function AuthForms({ mode }: { mode: Mode }) {
  if (!CLOUD) return <NoAccounts />;
  if (mode === 'signup') return <SignUp />;
  if (mode === 'forgot') return <Forgot />;
  if (mode === 'reset') return <Reset />;
  return <SignIn />;
}
