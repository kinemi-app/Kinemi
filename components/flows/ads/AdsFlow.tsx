"use client";

import { useState } from "react";
import { useJob } from "../../ui";
import { ResultStage } from "../index";
import flowStyles from "../flow.module.css";
import {
  EMPTY_BODY,
  EMPTY_TITLE,
  STILL_DURATION_S,
  type AdPanel,
  type AdRun,
} from "./adsConfig";
import { AdsModelPicker } from "./AdsModelPicker";
import { HooksPanel } from "./HooksPanel";
import { PostersPanel } from "./PostersPanel";
import { ProductPanel } from "./ProductPanel";
import { usePhotoSlot } from "./usePhotoSlot";
import { VideoPanel } from "./VideoPanel";
import { defaultStillModelForAds } from "./videoModels";
import styles from "./ads.module.css";

export function AdsFlow() {
  const [modelId, setModelId] = useState(() => defaultStillModelForAds().id);
  const [activePanel, setActivePanel] = useState<AdPanel | undefined>(undefined);
  const { job, error, running, submit } = useJob("ads");
  /** One product photo for the whole studio: the product, UGC and poster panels all use it. */
  const photo = usePhotoSlot();

  function runAd({ panel, feature, modelId: runModelId, prompt, durationS, params }: AdRun) {
    setActivePanel(panel);
    submit({
      mode: "ads",
      modelId: runModelId,
      prompt,
      durationS,
      params: { ...params, feature },
    });
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Campaigns</span>
        <h1>Marketing Studio</h1>
        <p className={flowStyles.lead}>
          Turn a product URL or photo into one still ad, a short UGC, unboxing or tutorial clip, a set
          of hook lines, or marketplace posters. Photos go to the asset store once, and every run
          reads them by name; without COMFY_URL the app stays in demo mode and returns a poster.
        </p>
      </header>

      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <div className={styles.modelBlock}>
            <span className={styles.controlLabel}>Model</span>
            <AdsModelPicker
              kind="image"
              durationS={STILL_DURATION_S}
              value={modelId}
              onChange={setModelId}
            />
            <p className={styles.note}>
              The still panels run {STILL_DURATION_S}s on this model. The video panel picks its own
              clip model.
            </p>
          </div>

          <ProductPanel
            modelId={modelId}
            photo={photo}
            running={running}
            active={running && activePanel === "product"}
            onRun={runAd}
          />
          <VideoPanel
            photo={photo}
            running={running}
            active={running && activePanel === "video"}
            onRun={runAd}
          />
          <HooksPanel modelId={modelId} />
          <PostersPanel
            modelId={modelId}
            photo={photo}
            running={running}
            active={running && activePanel === "posters"}
            onRun={runAd}
          />
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
