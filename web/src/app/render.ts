// The render queue. A job uploads its source asset when the tool needs one, submits one server job
// per take (POST /api/generate), polls them every second and saves what lands to the asset store
// with the server's file URL. A refusal or a failed run marks the job failed with the server's reason.
import { batch, signal } from '@preact/signals';
import { generate, getJob, getRegistry, upload, type ServerJob } from './backend';
import { requestFor } from './data/backend-request';
import { toolById } from './data/tools';
import { getFile } from './lib/files';
import { id as newId } from './lib/util';
import { announce } from './notify';
import { lanes } from './prefs';
import { mergeLive } from './render-live';
import { addAssets, assets, cast, jobs, updateMessage, type Asset, type Job, type RenderSpec } from './store';

/** Bumps when a render starts: the 3D clapperboard snaps on it. */
export const rendersStarted = signal(0);

const LETTERS = 'ABCDEFGH';
const POLL_MS = 1000;
/** The takes of one spec get seeds this far apart: each differs, and each can be rendered again. */
const SEED_STEP = 7919;

interface Landed {
  results: ServerJob[];
  /** the length the server rendered, after the model's cap */
  durationS: number;
}

export function queueRender(spec: RenderSpec) {
  const job: Job = { id: newId('j'), spec, status: 'queued', progress: 0 };
  jobs.value = [...jobs.value, job];
  syncCall(job, 'queued');
  pump();
  return job;
}

const jobById = (id: string) => jobs.value.find((j) => j.id === id);
const isLive = (id: string) => jobById(id)?.status === 'rendering';

function patchJob(id: string, patch: Partial<Job>) {
  jobs.value = jobs.value.map((j) => (j.id === id ? { ...j, ...patch } : j));
  return jobById(id)!;
}

// A single render has the server to itself; the cells of a batch run side by side, as many as
// Settings → Providers → Parallel renders allows (four by default).
function pump() {
  for (;;) {
    const running = jobs.value.filter((j) => j.status === 'rendering');
    const next = jobs.value.find((j) => j.status === 'queued');
    if (!next) return;
    if (running.length && !(next.spec.batch && running.length < lanes() && running.every((j) => j.spec.batch))) return;
    const started = patchJob(next.id, { status: 'rendering', startedAt: performance.now() });
    rendersStarted.value += 1;
    syncCall(started, 'rendering');
    void run(started);
  }
}

async function run(job: Job) {
  try {
    const landed = await render(job);
    if (landed && isLive(job.id)) finish(jobById(job.id)!, landed);
  } catch (e) {
    if (isLive(job.id)) fail(job, e instanceof Error ? e.message : 'The render failed.');
  } finally {
    pump();
  }
}

/** Upload the source, submit one server job per take and wait for all of them; null once cancelled. */
async function render(job: Job): Promise<Landed | null> {
  const s = job.spec;
  const registry = await getRegistry();
  const body = requestFor(s, registry, await uploadSource(s));
  if (!body) throw new Error(`${toolById(s.tool).name} doesn’t render on the server.`);
  const ids: string[] = [];
  for (let i = 0; i < Math.max(1, s.count ?? 1); i++) {
    if (!isLive(job.id)) return null;
    ids.push(await generate({ ...body, seed: s.seed + i * SEED_STEP }));
  }
  if (!isLive(job.id)) return null;
  patchJob(job.id, { serverIds: ids });
  const results = await poll(job.id, ids);
  return results && { results, durationS: body.durationS };
}

async function poll(jobId: string, ids: string[]): Promise<ServerJob[] | null> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (!isLive(jobId)) return null;
    const states = await Promise.all(ids.map(getJob));
    if (!isLive(jobId)) return null;
    const failed = states.find((j) => j.status === 'failed');
    if (failed) throw new Error(failed.error ?? 'The server couldn’t finish the render.');
    if (states.every((j) => j.status === 'succeeded')) return states;
    const live = mergeLive(states.map((j) => j.live));
    const progress = live ? live.fraction : states.reduce((sum, j) => sum + j.progress, 0) / (100 * states.length);
    patchJob(jobId, { progress, live });
  }
}

/** The tool's source asset, uploaded; undefined when the spec names none (the server says if it needs one). */
async function uploadSource(s: RenderSpec) {
  const id = s.server?.sourceId;
  const asset = id ? assets.value.find((a) => a.id === id) : undefined;
  if (!asset) return undefined;
  const blob = await fileOf(asset);
  const ext = blob.type.split('/')[1]?.split(';')[0] || 'bin';
  return { name: await upload(blob, `${asset.id}.${ext}`), kind: asset.kind };
}

async function fileOf(a: Asset): Promise<Blob> {
  const stored = a.file ? await getFile(a.id) : null;
  if (stored) return stored;
  if (a.url) {
    const response = await fetch(a.url).catch(() => null);
    if (response?.ok) return response.blob();
    throw new Error(`Couldn’t read “${a.name}” back from the server.`);
  }
  throw new Error(`“${a.name}” is a sample poster with no file behind it. Import a still or clip, or render one first.`);
}

function finish(job: Job, { results, durationS }: Landed) {
  const s = job.spec;
  const count = results.length;
  const folderId = s.folderId ?? null;
  const now = Date.now();
  const made: Asset[] = results.map((r, i) => ({
    id: newId('a'),
    name: count > 1 ? `${s.name} · ${s.tool === 'marketing' ? 'hook ' : 'look '}${LETTERS[i] ?? i + 1}` : s.name,
    kind: s.kind,
    tool: s.tool,
    model: s.model,
    folderId,
    tagIds: s.tagIds ?? [],
    favorite: false,
    createdAt: now - i,
    aspect: s.aspect,
    duration: s.duration === undefined ? undefined : durationS,
    prompt: s.prompt,
    params: s.params,
    runtime: s.estimate.runtime,
    credits: s.estimate.credits,
    scene: s.scene,
    seed: s.seed + i * SEED_STEP,
    palette: s.palette,
    panels: s.panels,
    source: s.chatId ? 'chat' : 'tool',
    chatId: s.chatId,
    batch: s.batch,
    cell: s.cell,
    url: r.result?.url,
    media: r.result?.kind,
  }));

  batch(() => {
    addAssets(made);
    if (s.tool === 'cast' && !cast.value.some((c) => c.name.toLowerCase() === s.name.toLowerCase())) {
      const tag = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
      cast.value = [...cast.value, { id: newId('c'), name: s.name, tag, look: s.prompt.split('.')[0], locked: true, seed: made[0].seed, createdAt: now }];
    }
    const live = mergeLive(results.map((r) => r.live));
    syncCall(patchJob(job.id, { status: 'done', progress: 1, live, doneAt: now, assetIds: made.map((a) => a.id) }), 'done');
  });

  // a batch reports once, when its last cell lands
  if (s.batch) {
    if (jobs.value.some((j) => j.spec.batch === s.batch && (j.status === 'queued' || j.status === 'rendering'))) return;
    const all = jobs.value.filter((j) => j.spec.batch === s.batch && j.status === 'done').length;
    announce({ title: `Batch done · ${all} renders`, body: `${s.name.split(' · ')[0]} · in its folder in Assets`, asset: made[0].id });
    return;
  }
  announce({
    title: count > 1 ? `${count} renders landed` : 'Render landed',
    body: `${made[0].name} · ${toolById(s.tool).name}`,
    asset: made[0].id,
  });
}

/** The job keeps the server's reason; its chat card goes back to Render and shows it. */
function fail(job: Job, error: string) {
  syncCall(patchJob(job.id, { status: 'failed', error, doneAt: Date.now() }), 'ready');
  // a batch reports its first failure only, so a refused plan doesn't stack a toast per cell
  const s = job.spec;
  if (s.batch && jobs.value.some((j) => j.id !== job.id && j.spec.batch === s.batch && j.status === 'failed')) return;
  announce({ title: 'Render failed', body: `${s.name} · ${error}` });
}

export function cancelJob(jobId: string) {
  const job = jobById(jobId);
  if (!job || (job.status !== 'queued' && job.status !== 'rendering')) return;
  syncCall(patchJob(jobId, { status: 'cancelled' }), 'ready');
}

export function clearFinished() {
  jobs.value = jobs.value.filter((j) => j.status === 'queued' || j.status === 'rendering');
}

/** Keep the chat card that asked for a render in step with its job; a failed job stays linked for its error. */
function syncCall(job: Job, status: 'queued' | 'rendering' | 'done' | 'ready') {
  const { chatId, msgId } = job.spec;
  if (!chatId || !msgId) return;
  const jobId = status === 'ready' && job.status !== 'failed' ? undefined : job.id;
  updateMessage(chatId, msgId, (m) => (m.call ? { ...m, call: { ...m.call, status, jobId, assetIds: job.assetIds ?? m.call.assetIds } } : m));
}
