"use client";

import { useEffect, useRef, useState } from "react";
import { MIN_BRIEF } from "../../../lib/studio/planner";
import { Button, Chip, EmptyState, Panel, Progress, Segmented, TextArea, cx } from "../../ui";
import flowStyles from "../flow.module.css";
import type { BatchShot, BatchStatus } from "./batch";
import { executeBatch, isPlannedShot, messageOf, readError } from "./batch";
import styles from "./studio.module.css";

type CopyState = "idle" | "copied" | "failed";

const CONCURRENCY_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "4", label: "4" },
];

const STATUS_LABELS: Record<BatchStatus, string> = {
  idle: "Waiting",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
};

const PLAN_PLACEHOLDER =
  "A 30-second launch ad for a red kettle: steam, warm kitchen light, a hand pouring, then the logo.";

const CLI_PLAN =
  'node bin/kinemi.mjs plan --brief "a 30-second launch ad for a red kettle" --base http://localhost:4321';
const CLI_BATCH = "node bin/kinemi.mjs batch --plan plan.json";
const CLI_SCHEDULE = "node bin/kinemi.mjs schedule list";
const CLI_COMMANDS = [CLI_PLAN, CLI_BATCH, CLI_SCHEDULE];
const CRONTAB_LINE =
  "0 9 * * * node /path/to/kinemi/bin/kinemi.mjs batch --plan /home/you/.kinemi/plan.json";

function statusClass(status: BatchStatus): string | undefined {
  switch (status) {
    case "running":
      return styles.statusRunning;
    case "succeeded":
      return styles.statusSucceeded;
    case "failed":
      return styles.statusFailed;
    case "idle":
      return undefined;
  }
}

function copyLabel(state: CopyState, idle: string): string {
  if (state === "copied") return "Copied";
  if (state === "failed") return "Copy failed";
  return idle;
}

export function StudioFlow() {
  const [brief, setBrief] = useState("");
  const [shots, setShots] = useState<BatchShot[]>([]);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | undefined>(undefined);
  const [concurrency, setConcurrency] = useState("1");
  const [running, setRunning] = useState(false);
  const [cliCopy, setCliCopy] = useState<CopyState>("idle");
  const [cronCopy, setCronCopy] = useState<CopyState>("idle");
  const abortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const briefReady = brief.trim().length >= MIN_BRIEF;
  const succeeded = shots.filter((shot) => shot.status === "succeeded").length;
  const finished = shots.filter(
    (shot) => shot.status === "succeeded" || shot.status === "failed",
  ).length;
  const summary =
    shots.length === 0
      ? ""
      : `${succeeded}/${shots.length} succeeded${finished === shots.length ? " · complete" : ""}`;

  function updateShot(index: number, patch: Partial<BatchShot>) {
    setShots((current) =>
      current.map((shot, at) => (at === index ? { ...shot, ...patch } : shot)),
    );
  }

  async function planCampaign() {
    if (!briefReady || planning || running) {
      return;
    }
    setPlanning(true);
    setPlanError(undefined);
    try {
      const response = await fetch("/api/studio/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const body = (await response.json()) as { shots?: unknown };
      if (!Array.isArray(body.shots) || !body.shots.every(isPlannedShot)) {
        throw new Error("The planner returned an unexpected shot list.");
      }
      setShots(body.shots.map((shot): BatchShot => ({ ...shot, status: "idle" })));
    } catch (cause) {
      setPlanError(messageOf(cause));
    } finally {
      setPlanning(false);
    }
  }

  async function runBatch() {
    if (running || shots.length === 0) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setShots((current) =>
      current.map((shot) => ({
        ...shot,
        status: "idle",
        error: undefined,
        resultUrl: undefined,
      })),
    );
    try {
      await executeBatch(shots, Number(concurrency), updateShot, controller.signal);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = undefined;
      }
      setRunning(false);
    }
  }

  async function copyText(text: string, target: "cli" | "cron") {
    try {
      await navigator.clipboard.writeText(text);
      if (target === "cli") {
        setCliCopy("copied");
      } else {
        setCronCopy("copied");
      }
    } catch {
      if (target === "cli") {
        setCliCopy("failed");
      } else {
        setCronCopy("failed");
      }
    }
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Campaign system</span>
        <h1>Supercomputer</h1>
        <p className={flowStyles.lead}>
          Plan a campaign from one brief, then run every shot through the same generator the rest
          of the app uses. The planner is a template, not a language model: the same brief returns
          the same six shots. The CLI and the scheduler work from the same files as this page.
        </p>
      </header>

      <div className={styles.layout}>
        <div className={styles.column}>
          <Panel title="Campaign planner" subtitle="One brief becomes a six-shot list.">
            <div className={styles.stack}>
              <TextArea
                label="Brief"
                hint={`At least ${MIN_BRIEF} characters. Say what the product is and what the ad should show.`}
                value={brief}
                onChange={setBrief}
                placeholder={PLAN_PLACEHOLDER}
                rows={5}
              />
              <Button
                wide
                onClick={planCampaign}
                disabled={!briefReady || running}
                loading={planning}
                title={
                  !briefReady
                    ? `Write at least ${MIN_BRIEF} characters`
                    : running
                      ? "A batch is running"
                      : undefined
                }
              >
                Plan campaign
              </Button>
              {planError ? <p className={flowStyles.error}>{planError}</p> : null}
            </div>
          </Panel>

          <Panel title="CLI and Skills" subtitle="The same planner and batch runner from a terminal.">
            <div className={styles.stack}>
              <p className={styles.note}>
                The server must run. These commands talk to the same /api/studio/plan and
                /api/generate routes as this page.
              </p>
              {CLI_COMMANDS.map((command) => (
                <pre key={command} className={styles.code}>
                  <code>{command}</code>
                </pre>
              ))}
              <div className={styles.row}>
                <Button variant="ghost" onClick={() => copyText(CLI_COMMANDS.join("\n"), "cli")}>
                  {copyLabel(cliCopy, "Copy CLI commands")}
                </Button>
              </div>
            </div>
          </Panel>
        </div>

        <div className={styles.column}>
          <Panel
            title="Batch runs"
            subtitle="Concurrent runs against the planned shots."
            right={shots.length > 0 ? <Chip>{`${shots.length} shots`}</Chip> : undefined}
          >
            <div className={styles.stack}>
              <div className={styles.batchControls}>
                <div className={styles.concurrency}>
                  <span className={styles.controlLabel}>Concurrency</span>
                  <Segmented
                    label="Concurrency"
                    value={concurrency}
                    options={CONCURRENCY_OPTIONS}
                    onChange={setConcurrency}
                  />
                </div>
                <Button onClick={runBatch} disabled={shots.length === 0 || planning} loading={running}>
                  Run batch
                </Button>
              </div>

              {shots.length > 0 ? (
                <p className={styles.summary} aria-live="polite">
                  {summary}
                </p>
              ) : null}

              {running ? (
                <Progress
                  value={shots.length === 0 ? 0 : (finished / shots.length) * 100}
                  label="Batch"
                />
              ) : null}

              {shots.length === 0 ? (
                <EmptyState
                  title="No plan yet"
                  body="Write a brief and plan a campaign; its shots land here before anything runs."
                />
              ) : (
                <ol className={styles.shots}>
                  {shots.map((shot) => (
                    <li key={shot.index} className={styles.shot}>
                      <div className={styles.shotHead}>
                        <span className={styles.shotIndex}>
                          {String(shot.index).padStart(2, "0")}
                        </span>
                        <span className={styles.shotTitle}>{shot.title}</span>
                        <span className={styles.shotMeta}>
                          {shot.mode} · {shot.durationS}s
                        </span>
                        <span
                          className={cx(styles.status, statusClass(shot.status))}
                          data-status={shot.status}
                        >
                          {STATUS_LABELS[shot.status]}
                        </span>
                      </div>
                      <p className={styles.prompt}>{shot.prompt}</p>
                      {shot.error ? <p className={flowStyles.error}>{shot.error}</p> : null}
                      {shot.resultUrl ? (
                        <a
                          className={styles.resultLink}
                          href={shot.resultUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open result
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>

          <Panel title="Scheduled runs" subtitle="A local cron entry around the batch command.">
            <div className={styles.stack}>
              <p className={styles.note}>
                <code>node bin/kinemi.mjs schedule add</code> writes ~/.kinemi/schedules.json and
                prints the crontab line to install. Scheduled runs use the local CLI; nothing runs
                while the machine is off.
              </p>
              <pre className={styles.code}>
                <code>{CRONTAB_LINE}</code>
              </pre>
              <div className={styles.row}>
                <Button variant="ghost" onClick={() => copyText(CRONTAB_LINE, "cron")}>
                  {copyLabel(cronCopy, "Copy crontab line")}
                </Button>
              </div>
              <p className={styles.note}>Connectors to Slack, Drive and Notion are not built.</p>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
