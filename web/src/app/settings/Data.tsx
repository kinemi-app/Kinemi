// Settings → Data & privacy: what Kinemi keeps on this device, backups, cleaning up and starting over.
// And Settings → Legal & about.
import { useEffect, useRef, useState } from 'preact/hooks';
import { CLOUD } from '../deploy';
import { cx, plural } from '../lib/util';
import { activeChatId, assets, chats, deleteForever, liveAssets, resetStudio, studioKey, trashed } from '../store';
import { Toggle } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { confirmDialog } from '../ui/layers';
import { toast } from '../ui/toast';
import { LEGAL, LOCAL_POLICIES_TEXT, POLICIES, isLoopbackHost, policyUrl } from '../../data/legal';
import { STORAGE } from '../../data/storage';
import { exportStudio, importStudio } from './backup';
import { Card, Chip, Row } from './parts';
import { account } from '../cloud/session';
import { wipeAccountStudio } from '../cloud/sync';

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`);

function Usage() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }), () => {});
    navigator.storage?.persisted?.().then(setPersisted, () => {});
  }, []);
  let studio = 0;
  try {
    studio = new Blob([localStorage.getItem(studioKey()) ?? '']).size;
  } catch {
    /* storage blocked */
  }
  const imported = assets.value.filter((a) => a.file);
  const files = imported.reduce((s, a) => s + (a.file?.size ?? 0), 0);
  const pct = est && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  return (
    <Card id="device" title="On this device" desc={CLOUD && account.value ? 'A copy of your account’s studio, so it opens at once and works offline.' : 'Your studio lives in this browser. Nothing of it is on a server.'}>
      <dl class="set-stats">
        <div>
          <dt>Studio</dt>
          <dd>{size(studio)}</dd>
          <small>
            {plural(liveAssets.value.length, 'render')}, {plural(chats.value.length, 'chat')}
          </small>
        </div>
        <div>
          <dt>Imported files</dt>
          <dd>{size(files)}</dd>
          <small>{plural(imported.length, 'file')}</small>
        </div>
        <div>
          <dt>All of this site</dt>
          <dd>{est ? size(est.usage) : '…'}</dd>
          <small>{est?.quota ? `of ${size(est.quota)} the browser allows` : 'the browser doesn’t say'}</small>
        </div>
      </dl>
      {est?.quota ? (
        <span class="pxbar set-bar" aria-hidden="true" style={{ '--p': `${pct}%` } as Record<string, string>}>
          <i />
        </span>
      ) : null}
      {persisted !== null && (
        <Toggle
          label="Keep my studio when the browser frees up space"
          sub={persisted ? 'On: the browser won’t clear it by itself' : 'Off: when space runs low, the browser may clear sites you haven’t used lately'}
          on={persisted}
          onChange={async (v) => {
            if (!v) return toast({ title: 'Only the browser can turn this off', body: 'Clear this site’s data in your browser’s settings to undo it.' });
            const ok = await navigator.storage.persist();
            setPersisted(ok);
            toast(ok ? { title: 'Your studio is kept', body: 'The browser won’t clear it to free up space.' } : { title: 'The browser said no', body: 'Some browsers only allow it for sites you bookmark or install.' });
          }}
        />
      )}
    </Card>
  );
}

function Backups() {
  const [withFiles, setWithFiles] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Card id="backup" title="Back up" desc="One .json file with your whole studio: renders, chats, folders, tags, cast and settings. Never your keys.">
      <Toggle label="Include imported files" sub="The images and clips you imported; makes the file bigger" on={withFiles} onChange={setWithFiles} />
      <div class="set-actions">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onClick={async () => {
            const name = await exportStudio(withFiles);
            toast({ title: 'Backup saved', body: name });
          }}
        >
          <PxIcon name="download" size={12} />
          Export the studio
        </button>
        <button type="button" class="btn btn-sm btn-ghost" onClick={() => input.current?.click()}>
          <PxIcon name="upload" size={12} />
          Import a backup…
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          class="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const el = e.currentTarget as HTMLInputElement;
            const f = el.files?.[0];
            el.value = '';
            if (!f) return;
            confirmDialog('Replace this studio with the backup?', {
              body: 'Everything in the studio now is replaced by what’s in the file. Your keys and this browser’s settings stay.',
              cta: 'Replace',
              danger: true,
              onConfirm: async () => {
                const r = await importStudio(f);
                if (r.ok) toast({ title: 'Backup restored', body: `${plural(r.assets, 'asset')}, ${plural(r.chats, 'chat')}${r.files ? `, ${plural(r.files, 'file')}` : ''}` });
                else toast({ title: 'Nothing changed', body: r.error });
              },
            });
          }}
        />
      </div>
    </Card>
  );
}

function CleanUp() {
  const bin = trashed.value;
  const list = chats.value;
  const signedIn = CLOUD && !!account.value;
  return (
    <Card id="clean" title="Clean up">
      <Row label="Empty the trash" desc={bin.length ? `${plural(bin.length, 'asset')} in the trash, deleted for good.` : 'The trash is empty.'}>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          disabled={!bin.length}
          onClick={() => confirmDialog('Empty the trash?', { body: `${plural(bin.length, 'asset')} will be deleted for good.`, cta: 'Empty the trash', danger: true, onConfirm: () => deleteForever(bin.map((a) => a.id)) })}
        >
          Empty
        </button>
      </Row>
      <Row label="Delete all chats" desc={list.length ? `${plural(list.length, 'chat')}. Their renders stay in Assets.` : 'No chats.'}>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          disabled={!list.length}
          onClick={() =>
            confirmDialog('Delete every chat?', {
              body: 'Their renders stay in Assets.',
              cta: 'Delete all chats',
              danger: true,
              onConfirm: () => {
                chats.value = [];
                activeChatId.value = null;
              },
            })
          }
        >
          Delete
        </button>
      </Row>
      {signedIn ? (
        <Row label="Start your account’s studio over" desc="Deletes every render, chat, folder and tag in your account, on every device. The account itself stays.">
          <button
            type="button"
            class="btn btn-sm btn-danger"
            onClick={() =>
              confirmDialog('Delete everything in your studio?', {
                body: 'Every render, chat, folder, tag and cast member in your account goes, on every device. This can’t be undone.',
                cta: 'Delete everything',
                danger: true,
                onConfirm: () => void wipeAccountStudio(),
              })
            }
          >
            Start over
          </button>
        </Row>
      ) : (
        <Row label="Reset this studio" desc="Back to the sample studio, with the default settings and no saved keys.">
          <button
            type="button"
            class="btn btn-sm btn-danger"
            onClick={() => confirmDialog('Reset the studio?', { body: 'Chats, renders, folders, tags, settings and your saved keys go. The sample studio comes back.', cta: 'Reset', danger: true, onConfirm: resetStudio })}
          >
            Reset
          </button>
        </Row>
      )}
    </Card>
  );
}

/** True on localhost: the studio is prerendered, so the check runs after hydration to keep both renders the same. */
function useIsLocalCopy() {
  const [isLocal, setIsLocal] = useState(false);
  useEffect(() => setIsLocal(isLoopbackHost(location.hostname)), []);
  return isLocal;
}

function Kept() {
  const isLocal = useIsLocalCopy();
  return (
    <Card
      id="kept"
      title="What Kinemi keeps"
      desc={
        <>
          No tracking, no ads, no analytics. Only what the studio needs, all of it in your browser.
          {' '}
          {isLocal ? (
            <span class="policies-placeholder">{LOCAL_POLICIES_TEXT}</span>
          ) : (
            <>
              More in the <a href={policyUrl('privacy')}>Privacy Policy</a> and on <a href={policyUrl('cookies')}>Cookies and storage</a>.
            </>
          )}
        </>
      }
    >
      <ul class="set-kept">
        {STORAGE.filter((s) => CLOUD || !s.accounts).map((s) => (
          <li key={s.key}>
            <code class="mono">{s.key}</code>
            <Chip>{s.where}</Chip>
            <p>{s.what}</p>
            <small>{s.keeps}</small>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DataSection() {
  return (
    <>
      <Usage />
      <Backups />
      <CleanUp />
      <Kept />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Legal & about                                                       */
/* ------------------------------------------------------------------ */

export function AboutSection() {
  const build = typeof __KINEMI_BUILD__ === 'undefined' ? { date: '', commit: '' } : __KINEMI_BUILD__;
  const contact = /^\[.*\]$/.test(LEGAL.email) ? '' : LEGAL.email;
  const isLocal = useIsLocalCopy();
  return (
    <>
      <Card id="kinemi" title="Kinemi" desc="Real camera language for AI film, on open models and your own compute.">
        <dl class="set-stats">
          <div>
            <dt>Build</dt>
            <dd class="mono">{build.date || 'development'}</dd>
            <small class="mono">{build.commit ? `commit ${build.commit}` : 'not a git checkout'}</small>
          </div>
          <div>
            <dt>Runs as</dt>
            <dd>{CLOUD ? 'Web version' : 'On this computer'}</dd>
            <small>{CLOUD ? 'with accounts' : 'no accounts, nothing on a server'}</small>
          </div>
          {LEGAL.license && (
            <div>
              <dt>License</dt>
              <dd class="mono">{LEGAL.license}</dd>
              <small>open source</small>
            </div>
          )}
        </dl>
        <div class="set-actions">
          {LEGAL.repoUrl && (
            <a class="btn btn-sm btn-ghost" href={LEGAL.repoUrl} target="_blank" rel="noopener noreferrer">
              <PxIcon name="code" size={12} />
              Source code
            </a>
          )}
          {contact && (
            <a class="btn btn-sm btn-ghost" href={`mailto:${contact}`}>
              <PxIcon name="mail" size={12} />
              {contact}
            </a>
          )}
        </div>
      </Card>
      <Card id="policies" title="Policies">
        {isLocal ? (
          <p class="policies-placeholder">{LOCAL_POLICIES_TEXT}</p>
        ) : (
          <ul class={cx('set-links')}>
            {POLICIES.map((p) => (
              <li key={p.slug}>
                <a href={policyUrl(p.slug)}>
                  <span>{p.title}</span>
                  <PxIcon name="arrow-right" size={12} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
