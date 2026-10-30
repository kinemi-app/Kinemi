// One tool on its own: controls, a viewfinder monitor, the prompt it writes, the cost, and the takes.
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { draftText, forcedTool } from '../chat/actions';
import { moveById } from '../data/moves';
import { toolById, type AppTool, type ToolId } from '../data/tools';
import { copyText, cx, plural, timecode } from '../lib/util';
import { queueRender } from '../render';
import { clock, elapsedMs, liveLine } from '../render-live';
import { go, href } from '../router';
import { withCompute } from '../shell/Compute';
import { assetById, cast, drafts, jobs, liveAssets, openAssetId, setDraft, toolFilter, type Asset, type Job } from '../store';
import { Estimate, Segmented } from '../ui/controls';
import { PxIcon, ToolIcon } from '../ui/icons';
import { Model3D } from '../ui/Model3D';
import { PixelProgress } from '../ui/PixelProgress';
import { markFresh, Poster } from '../ui/Poster';
import { toast } from '../ui/toast';
import { movePreview } from './camera-controls';
import { TOOL_MODE } from '../data/backend-map';
import { ServerComfyPanel } from './ComfyView';
import { FieldView } from './fields';
import { MoveDiagram } from './MoveDiagram';
import { Academy } from './Academy';
import { CanvasExtras, CanvasFields, CastFields, CastList, EmotionSheet, NodeBoard, Presets, SoulFields, StoryboardFields } from './panels';
import { buildFor, defaultsFor, sourceOf, type Values } from './recipes';
import { SCHEMAS } from './schemas';
import { Supercomputer } from './Supercomputer';
import { exportPreviz, aeKeyframes } from './previz';

function Head({ t, children }: { t: AppTool; children?: ComponentChildren }) {
  return (
    <header class="ws-head">
      <nav class="crumbs mono" aria-label="Breadcrumb">
        <a href={href({ view: 'tools' })}>Tools</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{t.name}</span>
      </nav>
      <div class="ws-title-row">
        <div class="ws-title">
          <Model3D model="voxel" opts={{ icon: t.id, active: true, spin: true }} class="ws-voxel">
            <ToolIcon id={t.id} size={44} />
          </Model3D>
          <div>
            <h1>{t.name}</h1>
            <p class="ws-tag mono">
              {t.tag}
              {t.studio && t.tag !== 'Studio' ? ' · Studio' : ''}
            </p>
          </div>
        </div>
        <div class="ws-actions">{children}</div>
      </div>
      <p class="ws-text">{t.text}</p>
    </header>
  );
}

function Hud({ values, label, rec, children }: { values: Values; label?: string; rec?: string; children?: ComponentChildren }) {
  const lens = values.lens ? String(values.lens).replace('mm', 'MM').replace(' anamorphic', ' ANA') : null;
  return (
    <div class="hud" aria-hidden="true">
      <i class="hud-third hud-v1" />
      <i class="hud-third hud-v2" />
      <i class="hud-third hud-h1" />
      <i class="hud-third hud-h2" />
      <i class="vf vf-tl" />
      <i class="vf vf-tr" />
      <i class="vf vf-bl" />
      <i class="vf vf-br" />
      <i class="hud-centre" />
      <span class="hud-label hud-tl mono">
        <i class="rec" />
        {rec ?? 'STBY'}
      </span>
      <span class="hud-label hud-tr mono">{lens ? `A-CAM · ${lens}${values.aperture ? ` · ${String(values.aperture).toUpperCase()}` : ''}` : 'A-CAM'}</span>
      {label && <span class="hud-label hud-bl mono">{label}</span>}
      {children}
    </div>
  );
}

function OrbitGizmo({ orbit, tilt }: { orbit: number; tilt: number }) {
  const a = ((orbit - 90) * Math.PI) / 180;
  return (
    <svg class="gizmo" viewBox="-50 -50 100 100" aria-hidden="true">
      <ellipse cx="0" cy="0" rx="40" ry="16" fill="none" stroke="rgba(255,255,255,0.3)" stroke-dasharray="3 3" />
      <circle cx="0" cy="0" r="5" fill="#f2f7f4" />
      <circle cx={Math.cos(a) * 40} cy={-Math.sin(a) * 16 - tilt * 0.4} r="5" fill="#39d879" />
      <line x1={Math.cos(a) * 40} y1={-Math.sin(a) * 16 - tilt * 0.4} x2="0" y2="0" stroke="#39d879" stroke-width="1.5" />
      <text x="0" y="36" text-anchor="middle" font-size="9" fill="#a7b4c0" font-family="ui-monospace, monospace">
        {`ORBIT ${orbit}° · TILT ${tilt}°`}
      </text>
    </svg>
  );
}

function Rendering({ job }: { job: Job }) {
  return (
    <div class="monitor-render">
      <Model3D model="clapper" opts={{ clap: job.status === 'rendering' ? 1 : 0 }} class="monitor-clapper">
        <PxIcon name="queue" size={48} />
      </Model3D>
      <p class="mono">{job.status === 'queued' ? 'Queued' : liveLine(job, `Rendering · ${Math.round(job.progress * 100)}%`, clock.value)}</p>
      <PixelProgress value={job.progress} blocks={36} />
    </div>
  );
}

function Takes({ tool, takes, shown, onPick }: { tool: ToolId; takes: Asset[]; shown?: Asset; onPick: (id: string) => void }) {
  if (!takes.length) return null;
  return (
    <section class="takes">
      <header class="takes-head">
        <h2>Takes</h2>
        <span class="mono">{plural(takes.length, 'render')}</span>
        <button
          type="button"
          class="link-btn"
          onClick={() => {
            toolFilter.value = [tool];
            go({ view: 'assets' });
          }}
        >
          All in Assets
          <PxIcon name="arrow-right" size={11} />
        </button>
      </header>
      <ul class="takes-list">
        {takes.map((a, i) => (
          <li key={a.id}>
            <button
              type="button"
              class={cx('take', shown?.id === a.id && 'is-on')}
              onClick={() => onPick(a.id)}
              onDblClick={() => {
                openAssetId.value = a.id;
                go({ view: 'assets' });
              }}
              aria-pressed={shown?.id === a.id}
            >
              <Poster asset={a} density={34} />
              <span class="take-n mono">T{String(takes.length - i).padStart(2, '0')}</span>
              <span class="sr-only">, {a.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SOURCE_TOOLS: ToolId[] = ['reshoot', 'edit', 'upscale', 'genjutsu'];

type Stage = 'monitor' | 'graph' | 'json';
/** Monitor, Comfy graph or API JSON: the stage keeps the choice from tool to tool. */
const stageView = signal<Stage>('monitor');

export function Workspace({ tool }: { tool: ToolId }) {
  const t = toolById(tool);
  const ctx = { assets: liveAssets.value, cast: cast.value };
  const values: Values = { ...defaultsFor(tool, ctx), ...(drafts.value[tool] ?? {}) };
  const set = (k: string, v: unknown) => setDraft(tool, k, v);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const job = jobId ? jobs.value.find((j) => j.id === jobId) : undefined;

  // a finished render shows up in the monitor, appearing pixel by pixel
  useEffect(() => {
    if (job?.status === 'done' && job.assetIds) {
      markFresh(job.assetIds.slice(0, 1));
      setPick(job.assetIds[0]);
      setJobId(null);
    }
  }, [job?.status]);

  const askChat = () => {
    forcedTool.value = tool === 'academy' || tool === 'presets' ? null : tool;
    draftText.value = String(values.prompt ?? values.sentence ?? values.script ?? values.change ?? (tool === 'supercomputer' ? `Plan a campaign: ${values.campaign}` : ''));
    go({ view: 'chat' });
  };
  const reset = () => {
    const d = { ...drafts.value };
    delete d[tool];
    drafts.value = d;
    setPick(null);
  };

  const headActions = (
    <>
      <button type="button" class="btn btn-sm btn-ghost" onClick={askChat}>
        <PxIcon name="chat" size={13} />
        Ask the chat
      </button>
      {drafts.value[tool] && (
        <button type="button" class="btn btn-sm btn-ghost" onClick={reset}>
          <PxIcon name="refresh" size={13} />
          Reset
        </button>
      )}
    </>
  );

  if (tool === 'supercomputer') {
    return (
      <section class="ws">
        <Head t={t}>{headActions}</Head>
        <Supercomputer values={values} set={set} ctx={ctx} />
      </section>
    );
  }

  if (tool === 'academy' || tool === 'presets') {
    return (
      <section class="ws ws-wide">
        <Head t={t}>
          <button type="button" class="btn btn-sm btn-ghost" onClick={askChat}>
            <PxIcon name="chat" size={13} />
            Ask the chat
          </button>
        </Head>
        {tool === 'academy' ? <Academy /> : <Presets />}
      </section>
    );
  }

  const built = buildFor(tool, values, ctx);
  const takes = liveAssets.value
    .filter((a) => a.tool === tool && a.source !== 'import')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  const busy = !!job && (job.status === 'queued' || job.status === 'rendering');
  const picked = pick ? assetById(pick) : undefined;
  const source = SOURCE_TOOLS.includes(tool) ? sourceOf(ctx, values.source, tool === 'genjutsu' ? ['video'] : tool === 'edit' ? ['video'] : ['still', 'video']) : undefined;
  const shown = picked ?? takes[0];
  const aspect = String(values.aspect ?? built?.spec.aspect ?? shown?.aspect ?? '16:9');
  const [w, h] = aspect.split(':').map(Number);
  const ratio = (w || 16) / (h || 9);

  const render = () => {
    if (!built || busy) return;
    withCompute(() => {
      const j = queueRender({ ...built.spec, params: built.params });
      setJobId(j.id);
      toast({ title: 'Rendering', body: `${built.title} · ${t.name}` });
    }, built.estimate.credits);
  };

  // what the monitor shows: the render in progress, a live preview, or a take
  let screen: ComponentChildren;
  let label = shown ? `TAKE ${String(takes.length - takes.indexOf(shown)).padStart(2, '0')} · ${shown.name.toUpperCase()}` : undefined;
  if (job && busy) screen = <Rendering job={job} />;
  else if (tool === 'soul' && built) {
    screen = <Poster asset={{ id: 'soul-live', kind: 'palette', scene: built.spec.scene, seed: built.spec.seed, palette: built.spec.palette }} density={120} />;
    label = 'LIVE PREVIEW · PALETTE LOCKED';
  } else if (tool === 'storyboard' && built) {
    screen = <Poster asset={{ id: 'board-live', kind: 'board', scene: built.spec.scene, seed: built.spec.seed, panels: built.spec.panels }} density={130} />;
    label = `BOARD · ${built.spec.panels} SHOTS`;
  } else if (tool === 'cast' && built) {
    screen = <EmotionSheet name={String(values.name)} seed={built.spec.seed} />;
    label = undefined;
  } else if (tool === 'previz') {
    screen = (
      <Model3D model="previz" opts={{ set: values.set, move: values.move, lens: values.lens }} class="monitor-3d" label="3D previz, drag to orbit">
        <Poster asset={{ id: 'previz-fallback', kind: 'previz', scene: 'previz', seed: 7 }} density={120} />
      </Model3D>
    );
    label = `PREVIZ · ${String(values.set).toUpperCase()} · DRAG TO ORBIT`;
  } else if (tool === 'canvas' && !picked) {
    screen = <NodeBoard nodes={values.nodes as string[]} />;
    label = 'NODE BOARD';
  } else if (!picked && source && (!takes.length || tool !== 'upscale')) {
    screen = (
      <>
        <Poster asset={source} density={120} />
        {tool === 'reshoot' && <OrbitGizmo orbit={Number(values.orbit)} tilt={Number(values.tilt)} />}
      </>
    );
    label = `SOURCE · ${source.name.toUpperCase()}`;
  } else if (shown) screen = <Poster asset={shown} density={120} />;
  else
    screen = (
      <div class="monitor-empty">
        <ToolIcon id={tool} size={40} />
        <p>No takes yet. Set it up on the left, check the cost, then render.</p>
      </div>
    );

  const hasGraph = !!TOOL_MODE[tool];
  const stage: Stage = hasGraph ? stageView.value : 'monitor';

  const firstMove = tool === 'cinematic' ? moveById((values.moves as string[])?.[0] ?? '') : tool === 'previz' ? moveById(String(values.move)) : undefined;

  return (
    <section class="ws">
      <Head t={t}>{headActions}</Head>
      <div class="ws-body">
        <form
          class="ws-controls"
          aria-label={`${t.name} settings`}
          onSubmit={(e) => {
            e.preventDefault();
            render();
          }}
        >
          {tool === 'storyboard' ? (
            <StoryboardFields values={values} set={set} />
          ) : tool === 'soul' ? (
            <SoulFields values={values} set={set} />
          ) : tool === 'cast' ? (
            <CastFields values={values} set={set} />
          ) : tool === 'canvas' ? (
            <CanvasFields values={values} set={set} />
          ) : (
            (SCHEMAS[tool] ?? []).map((def, i) => <FieldView key={i} def={def} values={values} set={set} />)
          )}
        </form>

        <div class="ws-stage">
          {hasGraph && (
            <div class="stage-bar">
              <Segmented<Stage>
                label="What the stage shows"
                size="sm"
                value={stage}
                onChange={(v) => (stageView.value = v)}
                options={[
                  { value: 'monitor', label: 'Monitor', icon: 'eye' },
                  { value: 'graph', label: 'Comfy graph', icon: 'graph' },
                  { value: 'json', label: 'API JSON', icon: 'code' },
                ]}
              />
              <span class="stage-note mono">{stage === 'monitor' ? 'live preview' : 'updates as you edit'}</span>
            </div>
          )}
          {stage !== 'monitor' ? (
            <ServerComfyPanel spec={built ? { ...built.spec, params: built.params } : undefined} view={stage} tool={t.slug} />
          ) : (
            <div class="monitor" style={{ '--r': ratio } as Record<string, number>}>
              <div class="monitor-screen" data-preview={tool === 'cinematic' && !busy ? (movePreview.value ?? undefined) : undefined}>
                {screen}
                <Hud values={values} label={label} rec={busy ? (job?.live ? `REC ${timecode(elapsedMs(job.live, clock.value) / 1000)}` : 'REC') : undefined}>
                  {firstMove && !busy && (
                    <span class="hud-move">
                      <MoveDiagram fx={firstMove.fx} />
                      <span class="mono">{firstMove.name.toUpperCase()}</span>
                    </span>
                  )}
                </Hud>
              </div>
            </div>
          )}

          {built && (
            <details class="prompt-out">
              <summary>
                <PxIcon name="chevron-right" size={11} />
                The prompt it writes
                <span class="mono">{built.prompt.length} chars</span>
              </summary>
              <div class="prompt-box">
                <pre class="mono">{built.prompt}</pre>
                <button type="button" class="icon-btn icon-btn-sm" aria-label="Copy the prompt" onClick={() => copyText(built.prompt).then(() => toast({ title: 'Prompt copied' }), () => {})}>
                  <PxIcon name="copy" size={12} />
                </button>
              </div>
            </details>
          )}

          <div class="ws-run">
            <div class="ws-run-info">
              {built ? (
                <>
                  <span class="ws-run-title">{built.title}</span>
                  <Estimate runtime={built.estimate.runtime} credits={built.estimate.credits} />
                </>
              ) : (
                <span class="field-note">{SOURCE_TOOLS.includes(tool) ? 'Pick a source first: render a shot, or import one in Assets.' : 'Fill in the settings to see the cost.'}</span>
              )}
            </div>
            <button type="button" class="btn btn-accent ws-render" disabled={!built || busy} onClick={render}>
              <PxIcon name="play" size={12} />
              {busy ? 'Rendering…' : 'Render'}
            </button>
          </div>

          {tool === 'previz' && (
            <div class="ws-extra ws-extra-row">
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                onClick={() =>
                  exportPreviz(String(values.set))
                    .then((ok) => ok && toast({ title: 'GLB exported', body: 'Open it in Blender or any 3D viewer.' }))
                    .catch(() => toast({ title: 'Couldn’t export the GLB' }))
                }
              >
                <PxIcon name="download" size={12} />
                Export GLB
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                onClick={() =>
                  copyText(aeKeyframes(String(values.move), String(values.lens), Number(String(values.duration).replace(/\D/g, '')) || 5)).then(
                    () => toast({ title: 'Camera keyframes copied', body: 'Paste them onto a camera in After Effects.' }),
                    () => {},
                  )
                }
              >
                <PxIcon name="copy" size={12} />
                Copy AE keyframes
              </button>
            </div>
          )}
          {tool === 'canvas' && <CanvasExtras />}
          {tool === 'cast' && <CastList />}

          <Takes tool={tool} takes={takes} shown={tool === 'canvas' && !picked ? undefined : shown} onPick={setPick} />
        </div>
      </div>
    </section>
  );
}
