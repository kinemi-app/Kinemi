import type { Job } from "../../lib/types";
import { EmptyState, Panel, Progress } from "../ui";
import styles from "./flow.module.css";

export type ResultStageProps = {
  job?: Job;
  error?: string;
  running: boolean;
  emptyTitle: string;
  emptyBody?: string;
};

/** The right-hand stage: one place for progress, failure, the result and the demo badge. */
export function ResultStage({ job, error, running, emptyTitle, emptyBody }: ResultStageProps) {
  const inFlight =
    job !== undefined && job.status !== "succeeded" && job.status !== "failed";
  const subtitle = running
    ? "Submitting the run"
    : inFlight
      ? "Rendering"
      : job?.status === "succeeded"
        ? "Result"
        : job?.status === "failed"
          ? "Failed"
          : "Nothing rendered yet";

  return (
    <Panel
      title="Stage"
      subtitle={subtitle}
      right={job?.demo ? <span className={styles.demo}>Demo</span> : undefined}
    >
      <div className={styles.stageBody}>
        {running && !job ? <Progress value={4} label="Submitting" /> : null}
        {inFlight ? <Progress value={job.progress} label="Rendering" /> : null}

        {job?.status === "failed" ? (
          <p className={styles.error}>{job.error ?? "The run failed."}</p>
        ) : null}

        {job?.status === "succeeded" && job.result ? (
          job.result.kind === "video" ? (
            <video
              className={styles.result}
              src={job.result.url}
              controls
              loop
              muted
              playsInline
              style={{ aspectRatio: `${job.result.width} / ${job.result.height}` }}
            />
          ) : (
            <img
              className={styles.result}
              src={job.result.url}
              alt="Generated result"
              style={{ aspectRatio: `${job.result.width} / ${job.result.height}` }}
            />
          )
        ) : null}

        {error ? <p className={styles.error}>{error}</p> : null}

        {!job && !running && !error ? (
          <EmptyState title={emptyTitle} body={emptyBody} />
        ) : null}

        {job === undefined || job.demo ? (
          <p className={styles.demoNote}>
            Demo build: the files you add stay in this browser and do not affect the result. Connect a
            ComfyUI server for real runs.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
