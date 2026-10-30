// What a render is really doing, from the server's live report (Job.live): what it waits for, how
// long it has run, how long it has left and what it cost. Nothing here guesses. A job with no report
// (the demo backend) shows its percentage only, and a remaining time the server can't give shows
// nothing.
import { effect, signal } from '@preact/signals';
import type { JobLive } from './backend';
import { formatRuntime } from './data/models';
import { isBrowser, plural } from './lib/util';
import { activeJobs, type Job } from './store';

const TICK_MS = 1000;
const CREDIT_DECIMALS = 2;

/** Wall-clock ms. It ticks every second while anything is queued or rendering, so elapsed counts between polls. */
export const clock = signal(Date.now());

if (isBrowser) {
  let timer: ReturnType<typeof setInterval> | undefined;
  effect(() => {
    const busy = activeJobs.value.length > 0;
    if (busy && !timer) {
      clock.value = Date.now();
      timer = setInterval(() => (clock.value = Date.now()), TICK_MS);
    } else if (!busy && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  });
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const earliest = (values: (number | undefined)[]) => {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length ? Math.min(...known) : undefined;
};

/**
 * One report for all of a job's takes; undefined unless every take has one. Remaining time, step and
 * node come from the one take still unfinished: with several unfinished, how their times add up
 * depends on how the server schedules them, so the studio shows none.
 */
export function mergeLive(reports: (JobLive | undefined)[]): JobLive | undefined {
  if (!reports.length || reports.some((r) => !r)) return undefined;
  const all = reports as JobLive[];
  if (all.length === 1) return all[0];
  const open = all.filter((r) => r.phase !== 'done');
  const phase = !open.length ? 'done' : all.every((r) => r.phase === 'queued') ? 'queued' : 'running';
  const only = open.length === 1 ? open[0] : undefined;
  return {
    phase,
    message: open.find((r) => r.phase === 'queued' && r.message)?.message,
    queuedAt: Math.min(...all.map((r) => r.queuedAt)),
    startedAt: earliest(all.map((r) => r.startedAt)),
    endedAt: phase === 'done' ? Math.max(...all.map((r) => r.endedAt ?? r.queuedAt)) : undefined,
    step: only?.step,
    steps: only?.steps,
    node: only?.node,
    fraction: sum(all.map((r) => r.fraction)) / all.length,
    remainingMs: only?.remainingMs,
    gpuMs: sum(all.map((r) => r.gpuMs)),
    credits: all.every((r) => r.credits !== undefined) ? sum(all.map((r) => r.credits as number)) : undefined,
    source: all[0].source,
  };
}

/** How long the run has gone on: from its start, or from when it queued if it hasn't started. */
export const elapsedMs = (live: JobLive, now: number) => Math.max(0, (live.endedAt ?? now) - (live.startedAt ?? live.queuedAt));

const seconds = (ms: number, round: (n: number) => number) => formatRuntime(round(ms / 1000));
const formatCredits = (credits: number) => plural(Number(credits.toFixed(CREDIT_DECIMALS)), 'credit');

/**
 * The words beside a job's percentage, each part already worded: what it waits for, or how long it
 * has run and has left and which step it is on, or once done its GPU time and credits. Empty with
 * no report.
 */
function liveDetails(job: Job, now: number): string[] {
  const live = job.live;
  if (!live) return [];
  if (live.phase === 'done') {
    const spent = [`GPU ${seconds(live.gpuMs, Math.round)}`];
    if (live.credits !== undefined) spent.push(formatCredits(live.credits));
    return spent;
  }
  const elapsed = `${seconds(elapsedMs(live, now), Math.floor)} elapsed`;
  if (live.phase === 'queued') return [live.message ?? 'Queued on the server', elapsed];
  const parts = [elapsed];
  if (live.remainingMs !== undefined) parts.push(`${seconds(live.remainingMs, Math.ceil)} left`);
  if (live.step !== undefined && live.steps) parts.push(`step ${live.step}/${live.steps}`);
  return parts;
}

/**
 * One line for a job: `lead` ("Rendering · 42%", "done"), then its live details. The lead goes while
 * the server still holds the job in its queue, so the line reads "Waiting for a machine… · 8 s elapsed".
 */
export function liveLine(job: Job, lead: string, now: number) {
  const waiting = job.live?.phase === 'queued';
  return [...(waiting ? [] : [lead]), ...liveDetails(job, now)].join(' · ');
}
