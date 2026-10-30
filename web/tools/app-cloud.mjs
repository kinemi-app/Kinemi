// Accounts, end to end, against a stand-in for Supabase (auth, the studio table, file storage) kept in memory.
//   node tools/app-cloud.mjs [base] [wall-base]
// base:      a build with accounts and guests allowed       (default http://127.0.0.1:4331)
// wall-base: a build with accounts and sign-in required     (default http://127.0.0.1:4332)
// Build them with the stand-in's address, then serve each one:
//   PUBLIC_SUPABASE_URL=https://kinemi-test.supabase.co PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npx astro build --outDir dist-cloud
//   PUBLIC_SUPABASE_URL=… PUBLIC_SUPABASE_PUBLISHABLE_KEY=… PUBLIC_GUEST_MODE=off npx astro build --outDir dist-cloud-wall
//   node server/local.mjs --dist dist-cloud --port 4331 & node server/local.mjs --dist dist-cloud-wall --port 4332 &
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const base = process.argv[2] || 'http://127.0.0.1:4331';
const wallBase = process.argv[3] || 'http://127.0.0.1:4332';
const SUPABASE = 'https://kinemi-test.supabase.co';
const { chromium } = createRequire(import.meta.url)('playwright');

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` · ${extra}` : ''}`);
  if (!ok) failed++;
};

/* ------------------------------------------------------------------ */
/* The stand-in                                                        */
/* ------------------------------------------------------------------ */

const db = {
  users: new Map(), // email → user
  tokens: new Map(), // access or refresh token → user id
  rows: new Map(), // `${uid}|${kind}|${id}` → row
  files: new Map(), // `${uid}/${id}` → { body, type }
  emails: [], // what the service would have sent
  rpc: [],
  autoconfirm: false,
};
let clock = Date.now();
const stamp = () => new Date((clock = Math.max(clock + 1, Date.now()))).toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), session_id: randomUUID() })}.c2lnbmF0dXJl`;
const userById = (id) => [...db.users.values()].find((u) => u.id === id);
const userJson = (u) => ({
  id: u.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: u.email,
  email_confirmed_at: u.confirmed ? u.created : null,
  confirmed_at: u.confirmed ? u.created : null,
  phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: u.meta,
  identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { email: u.email, sub: u.id } }],
  created_at: u.created,
  updated_at: stamp(),
  ...(u.newEmail ? { new_email: u.newEmail } : {}),
});
function session(u) {
  const access = jwt(u);
  const refresh = randomUUID();
  db.tokens.set(access, u.id);
  db.tokens.set(refresh, u.id);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: userJson(u) };
}

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const origin = req.headers()['origin'] || '*';
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': req.headers()['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, x-upsert',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'x-supabase-api-version, content-range',
    'x-supabase-api-version': '2024-01-01',
  };
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
  const error = (status, code, message) => json(status, { code, error_code: code, msg: message, message });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

  const token = (req.headers()['authorization'] || '').replace(/^Bearer /i, '');
  const uid = db.tokens.get(token);
  const body = (() => {
    try {
      return JSON.parse(req.postData() || 'null');
    } catch {
      return null;
    }
  })();
  const path = url.pathname;

  /* auth */
  if (path === '/auth/v1/signup') {
    const email = String(body.email).toLowerCase();
    if (db.users.has(email)) return json(200, { id: randomUUID(), email, identities: [] }); // no hints about who has an account
    const u = { id: randomUUID(), email, password: body.password, meta: body.data ?? {}, confirmed: db.autoconfirm, created: stamp() };
    db.users.set(email, u);
    if (u.confirmed) return json(200, session(u));
    db.emails.push({ to: email, kind: 'confirm', redirect: url.searchParams.get('redirect_to') });
    return json(200, { ...userJson(u), confirmation_sent_at: stamp() });
  }
  if (path === '/auth/v1/token') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const u = db.users.get(String(body.email).toLowerCase());
      if (!u || u.password !== body.password) return error(400, 'invalid_credentials', 'Invalid login credentials');
      if (!u.confirmed) return error(400, 'email_not_confirmed', 'Email not confirmed');
      return json(200, session(u));
    }
    if (grant === 'refresh_token') {
      const u = userById(db.tokens.get(body.refresh_token));
      return u ? json(200, session(u)) : error(400, 'refresh_token_not_found', 'Invalid Refresh Token');
    }
  }
  if (path === '/auth/v1/user') {
    const u = userById(uid);
    if (!u) return error(401, 'bad_jwt', 'invalid JWT');
    if (req.method() === 'PUT') {
      if (body.data) u.meta = { ...u.meta, ...body.data };
      if (body.password) u.password = body.password;
      if (body.email) {
        u.newEmail = body.email;
        db.emails.push({ to: body.email, kind: 'email_change' });
      }
    }
    return json(200, userJson(u));
  }
  if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
  if (path === '/auth/v1/recover') {
    db.emails.push({ to: String(body.email).toLowerCase(), kind: 'recovery', redirect: url.searchParams.get('redirect_to') });
    return json(200, {});
  }
  if (path === '/auth/v1/resend') {
    db.emails.push({ to: String(body.email).toLowerCase(), kind: 'resend' });
    return json(200, {});
  }

  /* the studio table */
  if (path === '/rest/v1/studio_items') {
    if (!uid) return error(401, 'PGRST301', 'JWT required');
    if (req.method() === 'GET') {
      const gt = url.searchParams.get('updated_at')?.replace(/^gt\./, '');
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 1000);
      const rows = [...db.rows.values()]
        .filter((r) => r.user_id === uid && (!gt || r.updated_at > gt))
        .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
        .slice(offset, offset + limit)
        .map(({ kind, id, data, deleted, updated_at }) => ({ kind, id, data, deleted, updated_at }));
      return json(200, rows);
    }
    if (req.method() === 'POST') {
      for (const r of body) {
        if (r.user_id !== uid) return error(403, '42501', 'new row violates row-level security policy');
        db.rows.set(`${uid}|${r.kind}|${r.id}`, { user_id: uid, kind: r.kind, id: r.id, data: r.data, deleted: !!r.deleted, updated_at: stamp() });
      }
      return json(201, undefined);
    }
  }
  if (path === '/rest/v1/rpc/delete_my_account') {
    const u = userById(uid);
    if (!u) return error(401, 'PGRST301', 'JWT required');
    db.rpc.push('delete_my_account');
    db.users.delete(u.email);
    for (const k of [...db.rows.keys()]) if (k.startsWith(`${u.id}|`)) db.rows.delete(k);
    return route.fulfill({ status: 204, headers: cors });
  }

  /* file storage */
  if (path.startsWith('/storage/v1/object/list/studio-files')) {
    const prefix = String(body.prefix ?? '');
    if (prefix !== uid) return json(200, []);
    return json(200, [...db.files.keys()].filter((k) => k.startsWith(`${uid}/`)).map((k) => ({ name: k.slice(uid.length + 1), id: k })));
  }
  if (path === '/storage/v1/object/studio-files' && req.method() === 'DELETE') {
    const gone = (body.prefixes ?? []).filter((p) => p.startsWith(`${uid}/`));
    gone.forEach((p) => db.files.delete(p));
    return json(200, gone.map((name) => ({ name })));
  }
  const file = path.match(/^\/storage\/v1\/object\/studio-files\/(.+)$/);
  if (file) {
    const key = decodeURIComponent(file[1]);
    if (!uid || !key.startsWith(`${uid}/`)) return error(403, 'Unauthorized', 'new row violates row-level security policy');
    if (req.method() === 'POST' || req.method() === 'PUT') {
      db.files.set(key, { body: req.postDataBuffer(), type: req.headers()['content-type'] });
      return json(200, { Key: `studio-files/${key}`, Id: randomUUID() });
    }
    const f = db.files.get(key);
    return f ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: f.body }) : error(404, 'not_found', 'Object not found');
  }
  return error(404, 'not_found', `No stand-in for ${req.method()} ${path}`);
}

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

const browser = await chromium.launch();
const problems = [];
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route(`${SUPABASE}/**`, handle);
  // Comfy Cloud refuses calls from web pages; the key check then says so. Nothing goes out from the test.
  await ctx.route('https://cloud.comfy.org/**', (route) => route.abort('blockedbyclient'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
  return page;
}
const rowsOf = (email, kind) => {
  const u = db.users.get(email);
  return u ? [...db.rows.values()].filter((r) => r.user_id === u.id && (!kind || r.kind === kind)) : [];
};
async function signIn(page, email, password, at = base) {
  await page.goto(`${at}/signin/`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('.auth-form button[type=submit]');
}

const A = 'ada@example.com';
const PW = 'correct horse battery';

// ---------------------------------------------------------------- sign up, with email confirmation
const a = await newPage();
await a.goto(`${base}/signup/`, { waitUntil: 'networkidle' });
check('Sign up offers to continue as a guest', (await a.locator('.auth-guest').count()) === 1);
await a.fill('#name', 'Ada Lovelace');
await a.fill('#email', A);
await a.fill('#password', PW);
await a.click('.auth-form button[type=submit]');
await a.waitForTimeout(300);
check('the Terms must be accepted first', ((await a.locator('.pg-error').textContent()) ?? '').includes('accept the Terms'));
await a.check('.pg-check input');
await a.click('.auth-form button[type=submit]');
await a.waitForSelector('.auth-card h1:has-text("Check your inbox")', { timeout: 8000 }).catch(() => {});
check('sign-up asks to confirm the email', (await a.locator('.auth-card h1').textContent()) === 'Check your inbox' && db.emails.some((e) => e.to === A && e.kind === 'confirm'));
check('the account keeps the name', db.users.get(A)?.meta?.name === 'Ada Lovelace');

// ---------------------------------------------------------------- sign in
await signIn(a, A, PW);
await a.waitForSelector('.pg-error', { timeout: 6000 }).catch(() => {});
check('an unconfirmed email can’t sign in yet', ((await a.locator('.pg-error').textContent()) ?? '').includes('Confirm your email first'));
db.users.get(A).confirmed = true;
await signIn(a, A, 'wrong password');
await a.waitForSelector('.pg-error', { timeout: 6000 }).catch(() => {});
check('a wrong password says so, without saying which part', ((await a.locator('.pg-error').textContent()) ?? '').includes('don’t match an account'));
await signIn(a, A, PW);
await a.waitForURL(`${base}/app/`, { timeout: 10000 }).catch(() => {});
await a.waitForSelector('.user-card:has-text("Ada Lovelace")', { timeout: 10000 }).catch(() => {});
check('signing in opens the studio, with your name', (await a.locator('.user-card b').textContent()) === 'Ada Lovelace');
check('signed in, there is no Sign in button', (await a.locator('.signin-btn').count()) === 0);
await a.waitForTimeout(2500);
check('a new account starts from the sample studio, saved to the account', rowsOf(A, 'asset').length > 20 && rowsOf(A, 'settings').length === 1, `${rowsOf(A).length} rows`);
check('the session is kept as kinemi-auth', await a.evaluate(() => !!localStorage.getItem('kinemi-auth')));

// a change goes up a moment later
await a.goto(`${base}/app/assets/`, { waitUntil: 'networkidle' });
await a.waitForTimeout(800);
await a.click('.side-label button[aria-label="New folder"]');
await a.fill('.dialog input', 'Cloud folder');
await a.click('.dialog .btn-primary');
await a.waitForTimeout(2500);
const folderRow = rowsOf(A, 'folder').find((r) => r.data?.name === 'Cloud folder');
check('a new folder is saved to the account', !!folderRow && !folderRow.deleted);

// ---------------------------------------------------------------- a second device
const b = await newPage();
await signIn(b, A, PW);
await b.waitForURL(`${base}/app/`, { timeout: 10000 }).catch(() => {});
await b.goto(`${base}/app/assets/`, { waitUntil: 'networkidle' });
await b.waitForSelector('.side-item:has-text("Cloud folder")', { timeout: 10000 }).catch(() => {});
check('the folder is on the second device', (await b.locator('.side-item:has-text("Cloud folder")').count()) === 1);
await b.locator('.side-item:has-text("Cloud folder") .side-more').click();
await b.click('.menu-item:has-text("Delete folder")');
await b.click('.dialog .btn-danger');
await b.waitForTimeout(2500);
check('deleting it there marks it deleted on the server', rowsOf(A, 'folder').find((r) => r.id === folderRow?.id)?.deleted === true);
await a.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await a.waitForTimeout(2000);
check('the first device drops it when it comes back into view', (await a.locator('.side-item:has-text("Cloud folder")').count()) === 0);

// keys stay in the browser
await a.goto(`${base}/app/settings/providers/`, { waitUntil: 'networkidle' });
await a.fill('#key-comfy-cloud-api-key', 'comfyui-cloud-test-key-5555');
await a.click('form.set-key:has(#key-comfy-cloud-api-key) button[type=submit]');
await a.waitForTimeout(2500);
check('keys you bring never reach the account', ![...db.rows.values()].some((r) => JSON.stringify(r.data).includes('comfyui-cloud-test-key-5555')));

// ---------------------------------------------------------------- account settings
await a.goto(`${base}/app/settings/account/`, { waitUntil: 'networkidle' });
await a.waitForSelector('#your-name', { timeout: 8000 }).catch(() => {});
await a.fill('#your-name', 'Ada King');
await a.click('#profile form.set-inline button[type=submit] >> nth=0');
await a.waitForTimeout(800);
check('the name changes on the account', db.users.get(A)?.meta?.name === 'Ada King' && (await a.locator('.user-card b').textContent()) === 'Ada King');
check('sync shows as saved', ((await a.locator('#sync .set-chip').first().textContent()) ?? '').includes('Saved to your account'));

// sign out: back to the guest studio
await a.click('#session button:has-text("Sign out") >> nth=0');
await a.click('.dialog .btn-primary');
await a.waitForSelector('.signin-btn', { timeout: 8000 }).catch(() => {});
check('signing out goes back to the guest studio', (await a.locator('.signin-btn').count()) === 1 && (await a.locator('.user-card b').textContent()) === 'Guest');
check('the key stays in the browser after signing out', await a.evaluate(() => (localStorage.getItem('kinemi.secrets.v1') ?? '').includes('comfyui-cloud-test-key-5555')));

// ---------------------------------------------------------------- a guest who signs up brings their studio along
db.autoconfirm = true;
const g = await newPage();
await g.goto(`${base}/app/assets/`, { waitUntil: 'networkidle' });
await g.waitForTimeout(600);
await g.click('.side-label button[aria-label="New folder"]');
await g.fill('.dialog input', 'Guest folder');
await g.click('.dialog .btn-primary');
await g.waitForTimeout(600);
await g.goto(`${base}/signup/`, { waitUntil: 'networkidle' });
await g.fill('#name', 'Grace Hopper');
await g.fill('#email', 'grace@example.com');
await g.fill('#password', 'a ship in harbour is safe');
await g.check('.pg-check input');
await g.click('.auth-form button[type=submit]');
await g.waitForSelector('.dialog h2:has-text("Bring this browser")', { timeout: 10000 }).catch(() => {});
check('a new account offers to bring the guest studio along', (await g.locator('.dialog h2').count()) === 1);
await g.click('.dialog .btn-primary');
await g.waitForTimeout(3000);
check('the guest folder comes along into the account', rowsOf('grace@example.com', 'folder').some((r) => r.data?.name === 'Guest folder'));

// ---------------------------------------------------------------- forgot and reset the password
const r = await newPage();
await r.goto(`${base}/forgot-password/`, { waitUntil: 'networkidle' });
await r.fill('#email', A);
await r.click('.auth-form button[type=submit]');
await r.waitForSelector('.auth-card h1:has-text("Check your inbox")', { timeout: 6000 }).catch(() => {});
check('Forgot password sends a link', db.emails.some((e) => e.to === A && e.kind === 'recovery' && e.redirect?.endsWith('/reset-password/')));
const recovery = session(db.users.get(A));
await r.goto(`${base}/reset-password/#access_token=${recovery.access_token}&expires_in=3600&expires_at=${recovery.expires_at}&refresh_token=${recovery.refresh_token}&token_type=bearer&type=recovery`, { waitUntil: 'networkidle' });
await r.waitForSelector('#password', { timeout: 8000 }).catch(() => {});
await r.fill('#password', 'a brand new passphrase');
await r.fill('#password2', 'a brand new passphrase');
await r.click('.auth-form button[type=submit]');
await r.waitForSelector('.auth-card h1:has-text("Password changed")', { timeout: 6000 }).catch(() => {});
check('the reset link sets a new password', db.users.get(A)?.password === 'a brand new passphrase');
const r2 = await newPage();
await r2.goto(`${base}/reset-password/`, { waitUntil: 'networkidle' });
await r2.waitForSelector('.auth-card h1', { timeout: 6000 });
check('without a valid link, Reset asks for a new one', (await r2.locator('.auth-card h1').textContent()) === 'This link has expired');

// ---------------------------------------------------------------- delete the account
const d = await newPage();
await signIn(d, A, 'a brand new passphrase');
await d.waitForURL(`${base}/app/`, { timeout: 10000 }).catch(() => {});
await d.waitForTimeout(1500);
await d.goto(`${base}/app/settings/account/`, { waitUntil: 'networkidle' });
await d.waitForSelector('#delete button', { timeout: 8000 });
await d.click('#delete button');
await d.fill('.dialog input', 'DELETE');
await d.click('.dialog .btn-danger');
await d.waitForSelector('.signin-btn', { timeout: 10000 }).catch(() => {});
check('Delete account removes the user and the studio', db.rpc.includes('delete_my_account') && !db.users.has(A) && rowsOf(A).length === 0);
check('afterwards the browser is a guest again', (await d.locator('.signin-btn').count()) === 1);

// ---------------------------------------------------------------- sign-in required
const w = await newPage();
await w.goto(`${wallBase}/app/tools/`, { waitUntil: 'networkidle' });
await w.waitForTimeout(500);
check('with sign-in required, the studio sends you to Sign in', new URL(w.url()).pathname === '/signin/' && new URL(w.url()).searchParams.get('next') === '/app/tools/');
check('…without a guest option', (await w.locator('.auth-guest').count()) === 0);
await w.fill('#email', 'grace@example.com');
await w.fill('#password', 'a ship in harbour is safe');
await w.click('.auth-form button[type=submit]');
await w.waitForURL(`${wallBase}/app/tools/`, { timeout: 10000 }).catch(() => {});
check('signing in goes back where you were going', new URL(w.url()).pathname === '/app/tools/');
await w.goto(`${wallBase}/`, { waitUntil: 'networkidle' });
check('the website’s main button starts an account', ((await w.locator('.nav-cta').textContent()) ?? '').includes('Get started'));
const n = await newPage();
await n.goto(`${wallBase}/signin/?next=https://evil.example/`, { waitUntil: 'networkidle' });
await n.fill('#email', 'grace@example.com');
await n.fill('#password', 'a ship in harbour is safe');
await n.click('.auth-form button[type=submit]');
await n.waitForTimeout(2000);
check('a next= pointing off the site is ignored', new URL(n.url()).origin === new URL(wallBase).origin);

// phones
const m = await newPage({ width: 390, height: 844 });
let wide = [];
for (const path of ['/signin/', '/signup/', '/forgot-password/', '/app/settings/account/']) {
  await m.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)) wide.push(path);
}
check('phones: no horizontal overflow', !wide.length, wide.join(' '));

console.log(problems.length ? `\nproblems:\n  ${[...new Set(problems)].join('\n  ')}` : '\nno page errors');
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
