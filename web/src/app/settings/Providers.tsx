// Settings → Providers: the keys you bring, where renders run, and who answers in the chat.
import { useEffect, useState } from 'preact/hooks';
import {
  forgetComfyKey,
  forgetEndpoint,
  forgetRouterKey,
  origin,
  rememberKeys,
  renderOn,
  routerModels,
  saveComfyKey,
  saveEndpoint,
  saveRouterKey,
  secrets,
  setRemember,
  testCloud,
  testLocal,
  testRouter,
  renderTarget,
  type Check,
} from '../compute';
import { onThisComputer, refreshLocal } from '../local';
import { plural } from '../lib/util';
import { patchSettings, settings, type Assistant } from '../store';
import { Segmented, Toggle } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { Card, Chip, Choice, KeyBox, Result, Row } from './parts';
import { ApprovalRow } from './ApprovalRow';
import { ProviderPicker } from './ProviderPicker';
import type { TestState } from './ProviderTest';

function Keys() {
  const sec = secrets.value;
  return (
    <Card
      id="keys"
      title="Keys you bring"
      desc="Your own keys for the services Kinemi talks to. They stay in this browser: they are never part of an export or your account, and each one only goes to its own service."
    >
      <div class="set-keys">
        <div class="set-keycol">
          <div class="set-keycol-head">
            <span class="set-keycol-ico" aria-hidden="true">
              <PxIcon name="server" size={16} />
            </span>
            <div>
              <b>Comfy Cloud</b>
              <small>Renders on your Comfy Cloud account</small>
            </div>
          </div>
          <KeyBox label="Comfy Cloud API key" value={sec.comfyKey} placeholder="comfyui-…" onSave={(k) => saveComfyKey(k)} onForget={forgetComfyKey} onTest={testCloud} />
          <p class="set-help">
            Make one at{' '}
            <a href="https://platform.comfy.org/login" target="_blank" rel="noopener noreferrer">
              platform.comfy.org
            </a>{' '}
            under API Keys. It is shown only once, so keep it in your password manager. API access needs a paid Comfy Cloud plan.
          </p>
        </div>
        <div class="set-keycol">
          <div class="set-keycol-head">
            <span class="set-keycol-ico" aria-hidden="true">
              <PxIcon name="chat" size={16} />
            </span>
            <div>
              <b>OpenRouter</b>
              <small>Runs the chat on the model you pick below</small>
            </div>
          </div>
          <KeyBox
            label="OpenRouter API key"
            value={sec.openrouterKey}
            placeholder="sk-or-…"
            onSave={(k) => {
              saveRouterKey(k);
              if (settings.value.assistant === 'builtin') patchSettings({ assistant: 'openrouter' });
            }}
            onForget={forgetRouterKey}
            onTest={testRouter}
          />
          <p class="set-help">
            Make one at{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
              openrouter.ai/keys
            </a>{' '}
            and give it a credit limit, so a key that gets out can’t run up a bill.
          </p>
        </div>
      </div>
      <Toggle label="Remember keys on this device" sub="Off: they are forgotten when you close this tab" on={rememberKeys.value} onChange={setRemember} />
    </Card>
  );
}

function Renders() {
  const s = settings.value;
  const target = renderTarget();
  const [address, setAddress] = useState(s.endpoint ?? 'http://127.0.0.1:8188');
  const [check, setCheck] = useState<Check | null | 'busy'>(null);
  // settings load after the page is drawn
  useEffect(() => {
    if (s.endpoint) setAddress(s.endpoint);
  }, [s.endpoint]);
  const hasKey = !!secrets.value.comfyKey;
  const saved = s.endpoint && origin(address) === s.endpoint;

  const test = async () => {
    if (!origin(address)) return setCheck({ ok: false, title: 'That isn’t an address', body: 'Use a full address, like http://127.0.0.1:8188' });
    if (!saved) saveEndpoint(address);
    setCheck('busy');
    setCheck(await testLocal(address));
  };

  return (
    <Card id="renders" title="Renders run on" desc={`${target.demo ? 'This Kinemi server makes demo renders: set COMFY_URL in its .env to render on ComfyUI.' : `This Kinemi server renders on ComfyUI at ${target.detail}.`} The keys below stay in this browser and don't change where renders run.`}>
      <div class="set-choices" role="radiogroup" aria-label="Renders run on">
        <Choice
          name="compute"
          value="key"
          checked={s.compute === 'key'}
          onChange={() => (hasKey ? renderOn('key') : document.getElementById('key-comfy-cloud-api-key')?.focus())}
          title="Comfy Cloud"
          desc={hasKey ? `Your key ••••${secrets.value.comfyKey!.slice(-4)}` : 'Add your key above first'}
          icon="server"
          status={s.compute === 'key' ? <Chip tone="ok">In use</Chip> : hasKey ? <Chip>Ready</Chip> : <Chip tone="warn">No key</Chip>}
        />
        <Choice
          name="compute"
          value="local"
          checked={s.compute === 'local'}
          onChange={() => (s.endpoint ? renderOn('local') : saveEndpoint(address))}
          title="Your own GPU"
          desc={s.endpoint ? `ComfyUI at ${s.endpoint.replace(/^https?:\/\//, '')}` : 'ComfyUI on this computer or your network'}
          icon="gpu"
          status={s.compute === 'local' ? <Chip tone="ok">In use</Chip> : s.endpoint ? <Chip>Ready</Chip> : null}
        />
      </div>
      <Row label="ComfyUI address" desc="Usually http://127.0.0.1:8188 on the machine that runs ComfyUI." stack>
        <form
          class="set-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void test();
          }}
        >
          <label class="sr-only" for="comfy-address">
            ComfyUI address
          </label>
          <input id="comfy-address" class="input mono" value={address} spellcheck={false} onInput={(e) => setAddress((e.currentTarget as HTMLInputElement).value)} />
          <button type="submit" class="btn btn-sm btn-ghost">
            <PxIcon name="bolt" size={12} />
            {saved ? 'Test connection' : 'Save and test'}
          </button>
          {s.endpoint && (
            <button
              type="button"
              class="btn btn-sm btn-ghost is-danger-text"
              onClick={() => {
                forgetEndpoint();
                setCheck(null);
              }}
            >
              Remove
            </button>
          )}
        </form>
        <Result check={check} />
      </Row>
      <Row label="Parallel renders" desc="How many cells of a Supercomputer batch render at once. One local ComfyUI works through its queue one at a time; Comfy Cloud plans allow more.">
        <Segmented label="Parallel renders" value={String(s.lanes)} onChange={(v) => patchSettings({ lanes: Number(v) })} options={['1', '2', '3', '4']} />
      </Row>
    </Card>
  );
}

function Chat() {
  const s = settings.value;
  // the server can't know the page is open on this computer: decide once it is in the browser
  const [local, setLocal] = useState(false);
  const [test, setTest] = useState<TestState>(null);
  useEffect(() => {
    const here = onThisComputer();
    setLocal(here);
    if (here) void refreshLocal();
  }, []);
  const choose = (a: Assistant) => {
    patchSettings({ assistant: a });
    setTest(null);
  };
  const options: Assistant[] = local ? ['builtin', 'openrouter', 'claude-code', 'codex'] : ['builtin', 'openrouter'];

  return (
    <Card id="chat" title="The chat runs on" desc="Who reads your messages and sets up the shots. Whatever you pick, every value it sets is checked against the tool’s own settings, and the built-in assistant steps in if it can’t answer.">
      <ProviderPicker options={options} onChoose={choose} chosen={s.assistant} test={test} onTest={setTest} />
      <ApprovalRow />
      {!local && (
        <p class="set-help">
          <PxIcon name="terminal" size={12} /> Running Kinemi on your own computer adds two more: the Claude Code and Codex you have installed there.
        </p>
      )}
    </Card>
  );
}

export function ProvidersSection() {
  const routers = routerModels.value.length;
  return (
    <>
      <Keys />
      <Renders />
      <Chat />
      <p class="set-foot mono">
        {plural(Object.values(secrets.value).filter(Boolean).length, 'key')} saved in this browser{routers ? ` · ${routers} OpenRouter models loaded` : ''}
      </p>
    </>
  );
}

