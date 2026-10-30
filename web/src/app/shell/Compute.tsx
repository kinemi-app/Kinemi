// The quick way to connect: the dialog a first render opens. Settings → Providers has the rest.
import { useState } from 'preact/hooks';
import { connected, forgetComfyKey, forgetEndpoint, rememberKeys, saveComfyKey, saveEndpoint, secrets } from '../compute';
import { primeSound } from '../notify';
import { go } from '../router';
import { settings } from '../store';
import { Segmented, Toggle } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { confirmDialog, openDialog } from '../ui/layers';
import { toast } from '../ui/toast';

type Mode = 'key' | 'local';

function ComputeForm({ close, then }: { close: () => void; then?: () => void }) {
  const s = settings.value;
  const [mode, setMode] = useState<Mode>(s.compute === 'local' ? 'local' : 'key');
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(rememberKeys.value);
  const [endpoint, setEndpoint] = useState(s.endpoint ?? 'http://127.0.0.1:8188');
  const [error, setError] = useState('');
  const isOn = connected();

  const save = (e: Event) => {
    e.preventDefault();
    if (mode === 'key') {
      if (key.trim().length < 8) return setError('That key looks too short. Paste the whole key.');
      saveComfyKey(key, remember);
      toast({ title: 'Comfy key saved', body: 'Renders run on your Comfy Cloud account.' });
    } else {
      if (!saveEndpoint(endpoint)) return setError('Use a full address, like http://127.0.0.1:8188');
      toast({ title: 'Local GPU connected', body: `Renders run on ${settings.value.endpoint?.replace(/^https?:\/\//, '')}.` });
    }
    close();
    then?.();
  };

  return (
    <form class="form compute" onSubmit={save}>
      {then && <p class="dialog-text compute-why">Kinemi renders on your own compute. Connect it once and this render starts right away.</p>}
      <Segmented<Mode>
        label="Compute"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError('');
        }}
        options={[
          { value: 'key', label: 'Comfy key' },
          { value: 'local', label: 'Local GPU' },
        ]}
      />
      {mode === 'key' && (
        <div class="compute-pane">
          <p class="dialog-text">Bring your own Comfy Cloud key: renders run on your account, and every flow still shows runtime and credits first.</p>
          <label class="field">
            <span class="field-label">Comfy API key</span>
            <input
              class="input mono"
              type="password"
              autoComplete="off"
              spellcheck={false}
              placeholder={secrets.value.comfyKey ? 'Saved. Paste a new key to replace it' : 'comfyui-••••••••••••'}
              value={key}
              onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)}
              autofocus
            />
          </label>
          <Toggle label="Remember on this device" sub="Off: the key is forgotten when you close this tab" on={remember} onChange={setRemember} />
          <p class="field-note">
            <PxIcon name="lock" size={12} /> Your key stays in this browser. It only ever goes to Comfy Cloud.
          </p>
        </div>
      )}
      {mode === 'local' && (
        <div class="compute-pane">
          <p class="dialog-text">Run ComfyUI on your own GPU and point Kinemi at it. Your hardware, your weights.</p>
          <label class="field">
            <span class="field-label">ComfyUI address</span>
            <input class="input mono" value={endpoint} onInput={(e) => setEndpoint((e.currentTarget as HTMLInputElement).value)} spellcheck={false} autofocus />
          </label>
        </div>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="form-actions">
        {isOn ? (
          <button
            type="button"
            class="btn btn-ghost btn-danger form-aside"
            onClick={() => {
              if (settings.value.compute === 'key') forgetComfyKey();
              else forgetEndpoint();
              toast({ title: 'Disconnected', body: 'Connect again whenever you want to render.' });
              close();
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            class="btn btn-sm btn-ghost form-aside"
            onClick={() => {
              close();
              go({ view: 'settings', section: 'providers' });
            }}
          >
            <PxIcon name="settings" size={13} />
            All provider settings
          </button>
        )}
        <button type="button" class="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button type="submit" class="btn btn-primary">
          {then ? 'Connect and render' : 'Connect'}
        </button>
      </div>
    </form>
  );
}

/** Opens the connection dialog; `then` runs once a connection is saved. */
export function openCompute(then?: unknown) {
  const next = typeof then === 'function' ? (then as () => void) : undefined;
  openDialog({ title: next ? 'Connect ComfyUI to render' : 'Where renders run', body: (close) => <ComputeForm close={close} then={next} /> });
}

/** Renders run where the Kinemi server is set up (demo or its ComfyUI), so nothing here asks for a key.
 *  With a spending limit set in Settings, anything that costs more asks first. */
export function withCompute(run: () => void, credits = 0) {
  primeSound();
  const guarded = () => {
    const limit = settings.value.confirmOver;
    if (limit > 0 && credits > limit) {
      confirmDialog(`This costs ${credits} credits`, {
        body: `That's more than your limit of ${limit} credits, set in Settings → Rendering. Render anyway?`,
        cta: 'Render',
        onConfirm: run,
      });
      return;
    }
    run();
  };
  guarded();
}

