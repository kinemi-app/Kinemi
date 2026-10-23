"use client";

import { useState } from "react";
import { defaultModelForMode } from "../../../lib/models";
import { useJob } from "../../ui";
import { ModelPicker, ResultStage } from "../index";
import flowStyles from "../flow.module.css";
import { CampaignPanel } from "./CampaignPanel";
import { MatchPanel } from "./MatchPanel";
import { SwapPanel } from "./SwapPanel";
import {
  EMPTY_BODY,
  EMPTY_TITLE,
  STILL_DURATION_S,
  type FashionFeature,
  type FashionRun,
} from "./fashionConfig";
import styles from "./fashion.module.css";

export function FashionFlow() {
  const [modelId, setModelId] = useState(() => defaultModelForMode("fashion").id);
  const [activeFeature, setActiveFeature] = useState<FashionFeature | undefined>(undefined);
  const { job, error, running, submit } = useJob("fashion");

  function runFashion({ feature, prompt, params }: FashionRun) {
    setActiveFeature(feature);
    submit({
      mode: "fashion",
      modelId,
      prompt,
      durationS: STILL_DURATION_S,
      params: { ...params, feature },
    });
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Wardrobe</span>
        <h1>Fashion Factory</h1>
        <p className={flowStyles.lead}>
          Put a garment on a model or swap the model under a garment, set the background and light,
          then build an influencer campaign still. Photos go to the asset store once, and every run
          reads them by name; without COMFY_URL the app stays in demo mode and returns a poster.
        </p>
      </header>

      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <div className={styles.modelBlock}>
            <span className={styles.controlLabel}>Model</span>
            <ModelPicker
              mode="fashion"
              value={modelId}
              durationS={STILL_DURATION_S}
              onChange={setModelId}
            />
            <p className={styles.note}>Every panel runs one still on this model.</p>
          </div>

          <SwapPanel
            running={running}
            active={running && activeFeature === "swap"}
            onRun={runFashion}
          />
          <MatchPanel
            running={running}
            active={running && activeFeature === "match"}
            onRun={runFashion}
          />
          <CampaignPanel modelId={modelId} />
        </div>

        <div className={flowStyles.stage}>
          <ResultStage
            job={job}
            error={error}
            running={running}
            emptyTitle={EMPTY_TITLE}
            emptyBody={EMPTY_BODY}
          />
        </div>
      </div>
    </main>
  );
}
