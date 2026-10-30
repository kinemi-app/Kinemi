// Supercomputer's workspace: the plan on the left, its grid of cells on the right. The chat makes
// one shot at a time; this makes a campaign: every deliverable × every variant, priced cell by cell,
// run as one batch, then reviewed and the keepers upscaled.
import { Fragment } from 'preact';
import { LOOKS } from '../data/options';
import { toolById } from '../data/tools';
import { copyText, cx, plural } from '../lib/util';
import { go } from '../router';
import { withCompute } from '../shell/Compute';
import { atATime } from '../prefs';
import { jobs, liveAssets, openAssetId, type Asset, type Job } from '../store';
import { Estimate, Field, Segmented, Slider } from '../ui/controls';
import { PxIcon, ToolIcon } from '../ui/icons';
import { openMenu } from '../ui/layers';
import { Poster } from '../ui/Poster';
import { toast } from '../ui/toast';
import { DELIVERABLES, isApproved, makePlan, needsFix, planSummary, planYaml, review, runPlan, upscaleApproved, type Axis, type Cell, type Plan } from './plan';
import type { Ctx, Values } from './recipes';

type Set = (key: string, value: unknown) => void;

function SuperFields({ values, set, plan }: { values: Values; set: Set; plan: Plan }) {
  const rows = (values.rows as string[]) ?? [];
  const looks = (values.looks as string[]) ?? [];
  const spare = Object.entries(DELIVERABLES).filter(([k]) => !rows.includes(k));
  return (
    <>
      <Field label="Campaign">
        <input class="input" value={String(values.campaign ?? '')} placeholder="SS27 trench launch" onInput={(e) => set('campaign', (e.currentTarget as HTMLInputElement).value)} />
      </Field>
      <Field label="In every shot" hint="{v} marks the column">
        <textarea class="textarea" rows={3} value={String(values.subject ?? '')} aria-label="In every shot" onInput={(e) => set('subject', (e.currentTarget as HTMLTextAreaElement).value)} />
      </Field>
      <Field label="Deliverables" hint={plural(rows.length, 'row')}>
        <ul class="deliv">
          {rows.map((r) => {
            const d = DELIVERABLES[r];
            if (!d) return null;
            return (
              <li key={r} class="deliv-row">
                <span class="deliv-ico">
                  <ToolIcon id={d.tool} size={16} />
                </span>
                <span class="deliv-text">
                  <b>{d.label}</b>
                  <small class="mono">
                    {toolById(d.tool).name} · {d.note}
                  </small>
                </span>
                <button type="button" class="icon-btn icon-btn-sm" aria-label={`Remove ${d.label}`} onClick={() => set('rows', rows.filter((x) => x !== r))}>
                  <PxIcon name="x" size={10} />
                </button>
              </li>
            );
          })}
        </ul>
        {spare.length > 0 && (
          <button
            type="button"
            class="move-add"
            aria-haspopup="menu"
            onClick={(e) =>
              openMenu(
                e.currentTarget as HTMLElement,
                spare.map(([k, d]) => ({ label: d.label, hint: d.note, onSelect: () => set('rows', [...rows, k]) })),
                { minWidth: 240 },
              )
            }
          >
            <PxIcon name="plus" size={12} />
            Add a deliverable
          </button>
        )}
      </Field>
      <Field label="Columns" hint={plural(plan.variants.length, 'variant')}>
        <Segmented<Axis> label="What changes from column to column" value={values.axis as Axis} options={['Places', 'Looks', 'Takes']} onChange={(v) => set('axis', v)} class="seg-block" />
        {values.axis === 'Places' && (
          <input class="input" aria-label="Places, separated by commas" value={String(values.places ?? '')} onInput={(e) => set('places', (e.currentTarget as HTMLInputElement).value)} />
        )}
        {values.axis === 'Looks' && (
          <div class="chips" role="group" aria-label="Looks, up to six">
            {LOOKS.map((l) => (
              <button
                key={l}
                type="button"
                class={cx('chip', looks.includes(l) && 'is-on')}
                aria-pressed={looks.includes(l)}
                onClick={() => set('looks', looks.includes(l) ? looks.filter((x) => x !== l) : [...looks, l].slice(-6))}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {values.axis === 'Takes' && <Slider label="Takes" value={Number(values.takes) || 3} min={2} max={6} onChange={(v) => set('takes', v)} format={(v) => `${v} takes`} />}
        <p class="field-note">{values.axis === 'Places' ? 'One column per place, up to six.' : values.axis === 'Looks' ? 'Same shot, a different grade per column.' : 'Same settings, a new seed per column.'}</p>
      </Field>
      <Field label="Budget" hint={`${plan.estimate.credits} planned`}>
        <Slider label="Budget" value={Number(values.budget) || 0} min={20} max={600} step={10} onChange={(v) => set('budget', v)} format={(v) => `${v} credits`} />
        <p class="field-note">Cells past the budget stay in the plan but don’t run.</p>
      </Field>
    </>
  );
}

function CellView({ c, job, asset, onToggle }: { c: Cell; job?: Job; asset?: Asset; onToggle: () => void }) {
  const spec = c.built?.spec;
  const state = asset ? 'done' : job ? job.status : !c.on ? 'off' : c.over ? 'over' : 'ready';
  const ok = asset && isApproved(asset);
  const fix = asset && needsFix(asset);
  const tag =
    state === 'done'
      ? ok
        ? 'approved'
        : fix
          ? 'needs fix'
          : 'take'
      : state === 'rendering'
        ? `${Math.round((job?.progress ?? 0) * 100)}%`
        : state === 'queued'
          ? 'queued'
          : state === 'over'
            ? 'over budget'
            : state === 'off'
              ? 'off'
              : `${c.built?.estimate.credits ?? 0} cr`;
  return (
    <div class={cx('pcell', `is-${state}`, ok && 'is-ok', fix && 'is-fix')}>
      <button
        type="button"
        class="pcell-main"
        aria-pressed={asset ? undefined : c.on}
        aria-label={`${c.name}: ${tag}${asset ? ', open in Assets' : c.on ? ', switch off' : ', switch on'}`}
        disabled={!c.built || !!job}
        onClick={() => {
          if (!asset) return onToggle();
          openAssetId.value = asset.id;
          go({ view: 'assets' });
        }}
      >
        {asset ? <Poster asset={asset} density={30} /> : spec ? <Poster asset={{ id: `cell-${c.key}-${spec.seed}`, kind: spec.kind, scene: spec.scene, seed: spec.seed, palette: spec.palette, panels: spec.panels }} density={30} /> : null}
        {job && <span class="pcell-bar" style={{ '--p': job.progress } as Record<string, number>} aria-hidden="true" />}
        <span class="pcell-tag mono">{tag}</span>
      </button>
      {asset && (
        <span class="pcell-review">
          <button type="button" class={cx('icon-btn', 'icon-btn-sm', ok && 'is-on')} aria-label={`Approve ${c.variant}`} aria-pressed={!!ok} onClick={() => review(asset, ok ? null : 'approved')}>
            <PxIcon name="check" size={11} />
          </button>
          <button type="button" class={cx('icon-btn', 'icon-btn-sm', fix && 'is-on')} aria-label={`${c.variant} needs a fix`} aria-pressed={!!fix} onClick={() => review(asset, fix ? null : 'needs fix')}>
            <PxIcon name="x" size={11} />
          </button>
        </span>
      )}
    </div>
  );
}

function Meter({ used, budget }: { used: number; budget: number }) {
  const pct = budget ? Math.min(100, (used / budget) * 100) : 0;
  return (
    <div class="meter" role="meter" aria-label="Budget used" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={used} aria-valuetext={`${used} of ${budget} credits`}>
      <span class="meter-bar">
        <span class="meter-fill" style={{ width: `${pct}%` }} />
      </span>
      <span class="meter-text mono">
        {used} / {budget} credits
      </span>
    </div>
  );
}

export function Supercomputer({ values, set, ctx }: { values: Values; set: Set; ctx: Ctx }) {
  const plan = makePlan(values, ctx);
  const batch = String(values.batch || '');
  const running = batch ? jobs.value.filter((j) => j.spec.batch === batch && (j.status === 'queued' || j.status === 'rendering')) : [];
  const results = batch ? liveAssets.value.filter((a) => a.batch === batch) : [];
  const approved = results.filter(isApproved);
  const off = (values.off as string[]) ?? [];
  const yaml = planYaml(plan, values);

  const run = () =>
    withCompute(() => {
      set('batch', runPlan(plan));
      toast({ title: 'Batch queued', body: `${plural(plan.run.length, 'render')} into “${plan.title}”, ${atATime()}.` });
    }, plan.estimate.credits);

  return (
    <div class="ws-body">
      <form
        class="ws-controls"
        aria-label="Supercomputer plan"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <SuperFields values={values} set={set} plan={plan} />
      </form>

      <div class="ws-stage">
        <section class="plan" aria-label="The plan">
          <header class="plan-head">
            <div>
              <h2>{plan.title}</h2>
              <p class="mono">{planSummary(plan)}</p>
            </div>
            <Meter used={plan.estimate.credits} budget={plan.budget} />
          </header>
          {plan.cells.length ? (
            <div class="plan-grid" style={{ '--cols': plan.variants.length } as Record<string, number>}>
              <span class="plan-corner mono">{String(values.axis)}</span>
              {plan.variants.map((v, i) => (
                <span key={i} class="plan-col mono">
                  {v}
                </span>
              ))}
              {plan.rows.map((r) => {
                const d = DELIVERABLES[r];
                return (
                  <Fragment key={r}>
                    <span class="plan-row">
                      <ToolIcon id={d.tool} size={14} />
                      <b>{d.label}</b>
                      <small class="mono">{d.aspect}</small>
                    </span>
                    {plan.cells
                      .filter((c) => c.row === r)
                      .map((c) => (
                        <CellView
                          key={c.key}
                          c={c}
                          job={running.find((j) => j.spec.cell === c.key)}
                          asset={results.find((a) => a.cell === c.key && a.tool === DELIVERABLES[r].tool)}
                          onToggle={() => set('off', off.includes(c.key) ? off.filter((k) => k !== c.key) : [...off, c.key])}
                        />
                      ))}
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <p class="empty-note">Add a deliverable and at least one column to see the plan.</p>
          )}
          <p class="plan-note">
            {results.length
              ? `${plural(results.length, 'take')} back · ${approved.length} approved. Tick the keepers, then upscale them in one go.`
              : 'Click a cell to leave it out. Every render lands in the campaign’s folder in Assets.'}
          </p>
        </section>

        <div class="ws-run">
          <div class="ws-run-info">
            <span class="ws-run-title">{running.length ? `Batch running · ${running.length} to go` : `${plural(plan.run.length, 'render')}, ${atATime()}`}</span>
            <Estimate runtime={plan.estimate.runtime} credits={plan.estimate.credits} />
          </div>
          {approved.length > 0 && (
            <button
              type="button"
              class="btn btn-ghost"
              onClick={() =>
                withCompute(() => {
                  const n = upscaleApproved(approved, ctx);
                  toast({ title: 'Upscale queued', body: `${plural(n, 'approved take')} to 4K, next to the originals.` });
                }, approved.reduce((sum, a) => sum + (a.credits ?? 0), 0))
              }
            >
              <PxIcon name="sparkle" size={12} />
              Upscale {approved.length} approved
            </button>
          )}
          <button type="button" class="btn btn-accent ws-render" disabled={!plan.run.length || running.length > 0} onClick={run}>
            <PxIcon name="play" size={12} />
            {running.length ? 'Running…' : 'Run plan'}
          </button>
        </div>

        <section class="ws-extra">
          <header class="ws-extra-head">
            <h2>The plan as a file</h2>
            <span class="ws-extra-actions">
              <button type="button" class="icon-btn icon-btn-sm" aria-label="Copy plan.yaml" onClick={() => copyText(yaml).then(() => toast({ title: 'plan.yaml copied' }), () => {})}>
                <PxIcon name="copy" size={12} />
              </button>
            </span>
          </header>
          <pre class="cli mono" tabIndex={0}>{yaml}</pre>
          <pre class="cli mono" tabIndex={0}>
            <span class="cli-prompt">$ </span>
            kinemi run plan.yaml --parallel 4 --budget {plan.budget}
          </pre>
        </section>
      </div>
    </div>
  );
}
