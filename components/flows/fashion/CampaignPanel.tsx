"use client";

import { useState } from "react";
import { Button, Chip, Panel, Slider, TextArea } from "../../ui";
import type { GenerateRequest } from "../../../lib/types";
import { useBatchJobs, type BatchItem } from "../ads/useBatchJobs";
import {
  MODELS_DEFAULT,
  MODELS_MAX,
  MODELS_MIN,
  POSES,
  STILL_DURATION_S,
  campaignSeed,
} from "./fashionConfig";
import flowStyles from "../flow.module.css";
import styles from "./fashion.module.css";

type Props = { modelId: string };

function statusText(item: BatchItem): string {
  switch (item.status) {
    case "queued":
      return "Queued";
    case "running":
      return `Rendering ${item.progress}%`;
    case "succeeded":
      return "Done";
    default:
      return "Failed";
  }
}

export function CampaignPanel({ modelId }: Props) {
  const [modelCount, setModelCount] = useState(MODELS_DEFAULT);
  const [poses, setPoses] = useState<string[]>(["standing"]);
  const [campaignLine, setCampaignLine] = useState("");
  const { items, running, run } = useBatchJobs();
  const selectedPoses = POSES.filter((pose) => poses.includes(pose.id));
  const poseWords = selectedPoses.map((pose) => pose.id).join(", ");
  const poseParam = selectedPoses.map((pose) => pose.id).join(",");
  const hasLine = campaignLine.trim() !== "";
  const canBuild = hasLine && selectedPoses.length > 0;
  const failed = items.filter((item) => item.status === "failed").length;
  const done = items.filter((item) => item.status === "succeeded").length;
  let disabledTitle: string | undefined;
  if (!hasLine) {
    disabledTitle = "Write the campaign line first";
  } else if (selectedPoses.length === 0) {
    disabledTitle = "Pick at least one pose";
  } else if (running) {
    disabledTitle = "The campaign models are rendering";
  }

  function togglePose(id: string) {
    setPoses((current) =>
      current.includes(id) ? current.filter((pose) => pose !== id) : [...current, id],
    );
  }

  function buildCampaign() {
    if (!canBuild || running) {
      return;
    }
    const line = campaignLine.trim();
    // One job per model, each with its own deterministic seed, so the same line always casts alike.
    const requests: GenerateRequest[] = Array.from({ length: modelCount }, (_, index) => ({
      mode: "fashion",
      modelId,
      prompt: `influencer campaign: ${line} (model ${index + 1} of ${modelCount}, ${poseWords})`,
      durationS: STILL_DURATION_S,
      seed: campaignSeed(line, index),
      params: {
        feature: "campaign",
        models: modelCount,
        modelIndex: index,
        poses: poseParam,
      },
    }));
    run(requests);
  }

  return (
    <Panel title="Influencer campaign" subtitle="One line, a few models and a pose set; each model renders its own still.">
      <div className={styles.stack}>
        <Slider label="Models" value={modelCount} min={MODELS_MIN} max={MODELS_MAX} step={1} onChange={setModelCount} />
        <div className={styles.fieldGroup}>
          <span className={styles.controlLabel}>Poses</span>
          <div className={styles.chips} role="group" aria-label="Poses">
            {POSES.map((pose) => (
              <Chip key={pose.id} active={poses.includes(pose.id)} onClick={() => togglePose(pose.id)}>
                {pose.label}
              </Chip>
            ))}
          </div>
          <p className={styles.note}>Pick one or more.</p>
        </div>
        <TextArea label="Campaign line" hint="What the campaign says." value={campaignLine} onChange={setCampaignLine} placeholder="Made for the walk from the train to the office." rows={3} />
        {items.length > 0 ? (
          <ol className={styles.runList} aria-label="Campaign renders">
            {items.map((item, index) => (
              <li key={index} className={styles.runRow}>
                <span className={styles.runIndex}>Model {index + 1}</span>
                <span className={item.status === "failed" ? flowStyles.error : styles.runStatus}>
                  {statusText(item)}
                </span>
                {item.status === "failed" ? <span className={flowStyles.error}>{item.error}</span> : null}
                {item.status === "succeeded" && item.result ? (
                  <a className={styles.runLink} href={item.result.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        {items.length > 0 ? (
          <p className={styles.note}>
            {done} of {items.length} rendered{failed > 0 ? `, ${failed} failed` : ""}.
          </p>
        ) : null}
        <Button wide onClick={buildCampaign} disabled={!canBuild || running} loading={running} title={disabledTitle}>
          Build campaign
        </Button>
      </div>
    </Panel>
  );
}
