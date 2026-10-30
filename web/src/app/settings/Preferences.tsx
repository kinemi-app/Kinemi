// Settings → Rendering, Interface and Notifications: how renders come out, how the studio behaves,
// and how it tells you a render landed.
import { useEffect, useState } from 'preact/hooks';
import { askToNotify, canNotify, chime, desktop, primeSound } from '../notify';
import { cx } from '../lib/util';
import { DEFAULT_SETTINGS, NEG_IMAGE, NEG_VIDEO, patchSettings, settings } from '../store';
import { prefixFor } from '../tools/comfy';
import { Segmented, Slider, Toggle } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { toast } from '../ui/toast';
import { Card, Chip, Row } from './parts';

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function Negative({ label, value, fallback, set }: { label: string; value: string; fallback: string; set: (v: string) => void }) {
  const id = `neg-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div class="set-neg">
      <div class="set-neg-head">
        <label for={id}>{label}</label>
        {value !== fallback && (
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => set(fallback)}>
            Reset
          </button>
        )}
      </div>
      <textarea id={id} class="textarea mono" rows={2} value={value} onInput={(e) => set((e.currentTarget as HTMLTextAreaElement).value)} />
    </div>
  );
}

export function RenderingSection() {
  const s = settings.value;
  const preview = prefixFor('cinematic', 'Rain-soaked neon street', s.prefix);
  return (
    <>
      <Card id="start" title="New shots start at" desc="What a fresh shot is set to. A tool can still change it for one render.">
        <Row label="Resolution" desc="Draft at 720p and upscale the take you keep: it costs about half as much.">
          <Segmented label="Resolution" value={s.res} onChange={(v) => patchSettings({ res: v as '720p' | '1080p' })} options={['720p', '1080p']} />
        </Row>
        <Row label="Frame rate" desc="ComfyUI renders at this rate, and the frame counts follow it. 24 is cinema, 25 is PAL, 30 is online video.">
          <Segmented label="Frame rate" value={String(s.fps)} onChange={(v) => patchSettings({ fps: Number(v) as 24 | 25 | 30 })} options={['24', '25', '30']} />
        </Row>
      </Card>
      <Card id="negative" title="Negative prompts" desc="What the models should stay away from, sent with every render.">
        <Negative label="Video" value={s.negVideo} fallback={NEG_VIDEO} set={(v) => patchSettings({ negVideo: v })} />
        <Negative label="Stills" value={s.negImage} fallback={NEG_IMAGE} set={(v) => patchSettings({ negImage: v })} />
      </Card>
      <Card id="names" title="File names" desc="The folder and name ComfyUI saves a render under, inside its output folder.">
        <Row label="Pattern" desc={<>Use {'{tool}'}, {'{name}'} and {'{date}'}. Slashes make folders.</>} stack>
          <label class="sr-only" for="prefix">
            File name pattern
          </label>
          <input id="prefix" class="input mono" value={s.prefix} spellcheck={false} placeholder={DEFAULT_SETTINGS.prefix} onInput={(e) => patchSettings({ prefix: (e.currentTarget as HTMLInputElement).value })} />
          <p class="set-help mono">
            For example: output/{preview}_00001.mp4
          </p>
        </Row>
      </Card>
      <Card id="limit" title="Spending limit" desc="Your key, your money. Kinemi always shows the cost first; this also asks before anything big.">
        <Toggle
          label="Ask before anything over a limit"
          sub={s.confirmOver ? `Renders and batches over ${s.confirmOver} credits ask first` : 'Off: renders start when you press Render'}
          on={s.confirmOver > 0}
          onChange={(v) => patchSettings({ confirmOver: v ? 40 : 0 })}
        />
        {s.confirmOver > 0 && <Slider label="Limit" value={s.confirmOver} min={10} max={500} step={10} format={(v) => `${v} credits`} onChange={(v) => patchSettings({ confirmOver: v })} />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

const THREE_KEY = 'kinemi.3d';

function read3d(): 'auto' | 'on' | 'off' {
  try {
    const v = localStorage.getItem(THREE_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

const SHORTCUTS: Array<[string[], string]> = [
  [['/'], 'Focus the chat box, or the search in Assets'],
  [['N'], 'New chat'],
  [['1'], 'Chat'],
  [['2'], 'Tools'],
  [['3'], 'Assets'],
  [['['], 'Fold the sidebar into a rail, and back'],
  [[','], 'Settings'],
  [['Esc'], 'Close a menu, dialog or panel'],
  [['⌘ / Ctrl', 'A'], 'Assets: select everything'],
  [['F'], 'Assets: favourite the selection'],
  [['Delete'], 'Assets: move the selection to the trash'],
  [['←', '→'], 'Asset drawer: the previous or next asset'],
];

export function InterfaceSection() {
  const s = settings.value;
  const [three, setThree] = useState<'auto' | 'on' | 'off'>('auto');
  const [changed3d, setChanged3d] = useState(false);
  useEffect(() => setThree(read3d()), []);
  return (
    <>
      <Card id="motion" title="Motion" desc="Kinemi moves a lot: monitors, rigs, the 3D set. Reduce it if motion bothers you.">
        <Row label="Animations" desc="“Follow my system” uses your device’s reduce-motion setting.">
          <Segmented
            label="Animations"
            value={s.motion}
            onChange={(v) => patchSettings({ motion: v as 'system' | 'reduce' })}
            options={[
              { value: 'system', label: 'Follow my system' },
              { value: 'reduce', label: 'Reduce' },
            ]}
          />
        </Row>
      </Card>
      <Card id="three" title="3D models" desc="The orb, the cinema camera, the voxel icons. Auto turns them on when your graphics card can draw them smoothly.">
        <Row label="3D" desc={changed3d ? 'Changes when the page reloads.' : 'Off keeps the pixel icons: lighter on battery.'}>
          <Segmented
            label="3D models"
            value={three}
            onChange={(v) => {
              setThree(v as 'auto' | 'on' | 'off');
              setChanged3d(true);
              try {
                if (v === 'auto') localStorage.removeItem(THREE_KEY);
                else localStorage.setItem(THREE_KEY, v);
              } catch {
                /* storage blocked */
              }
            }}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
        {changed3d && (
          <div class="set-actions">
            <button type="button" class="btn btn-sm btn-ghost" onClick={() => location.reload()}>
              <PxIcon name="refresh" size={12} />
              Reload now
            </button>
          </div>
        )}
      </Card>
      <Card id="layout" title="Layout">
        <Toggle label="Full sidebar" sub="Off folds it into a rail of icons ( [ does the same )" on={s.sidebar} onChange={(v) => patchSettings({ sidebar: v })} />
        <Toggle label="The “Render on your own GPU” card" sub="Shown in the sidebar while nothing is connected" on={s.gpuCard} onChange={(v) => patchSettings({ gpuCard: v })} />
      </Card>
      <Card id="keyboard" title="Keyboard">
        <Toggle label="Single-key shortcuts" sub="Off if you use speech input or a screen reader that types letters" on={s.keys} onChange={(v) => patchSettings({ keys: v })} />
        <table class={cx('set-keys-table', !s.keys && 'is-off')}>
          <caption class="sr-only">Keyboard shortcuts</caption>
          <tbody>
            {SHORTCUTS.map(([keys, what]) => (
              <tr key={what}>
                <td>
                  {keys.map((k) => (
                    <kbd key={k} class="kbd">
                      {k}
                    </kbd>
                  ))}
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function NotificationsSection() {
  const s = settings.value;
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
  useEffect(() => setPerm(canNotify() ? Notification.permission : 'unsupported'), []);
  const permChip =
    perm === 'granted' ? <Chip tone="ok">Allowed</Chip> : perm === 'denied' ? <Chip tone="bad">Blocked in the browser</Chip> : perm === 'unsupported' ? <Chip>Not in this browser</Chip> : <Chip>Not asked yet</Chip>;
  return (
    <Card id="render-done" title="When a render lands" desc="Renders take a while. Pick how Kinemi tells you one is ready.">
      <Toggle label="A message in the studio" sub="In the corner, with a button to open the render" on={s.notifyToast} onChange={(v) => patchSettings({ notifyToast: v })} />
      <Toggle
        label="A chime"
        sub="Two short blips"
        on={s.notifySound}
        onChange={(v) => {
          primeSound();
          patchSettings({ notifySound: v });
          if (v) setTimeout(chime, 60);
        }}
      />
      <Row label="A browser notification" desc="While Kinemi is in the background, so you can work elsewhere. Your browser asks first.">
        {permChip}
        <Toggle
          label={s.notifyDesktop ? 'On' : 'Off'}
          on={s.notifyDesktop && perm === 'granted'}
          onChange={async (v) => {
            if (!v) return patchSettings({ notifyDesktop: false });
            const p = await askToNotify();
            setPerm(p);
            patchSettings({ notifyDesktop: p === 'granted' });
            if (p === 'denied') toast({ title: 'Notifications are blocked', body: 'Allow them for this site in your browser’s site settings.' });
          }}
        />
      </Row>
      <div class="set-actions">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onClick={() => {
            primeSound();
            const t = { title: 'Render landed', body: 'This is how Kinemi tells you. Nothing rendered.' };
            if (s.notifyToast) toast(t);
            if (s.notifySound) setTimeout(chime, 60);
            if (s.notifyDesktop) desktop(t.title, t.body);
            if (!s.notifyToast && !s.notifySound && !s.notifyDesktop) toast({ title: 'Everything is off', body: 'Switch one on to hear about finished renders.' });
          }}
        >
          <PxIcon name="bell" size={12} />
          Send a test
        </button>
      </div>
    </Card>
  );
}
