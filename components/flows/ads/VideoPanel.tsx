"use client";

import { useState } from "react";
import { Button, Dropzone, Panel, Segmented, TextArea } from "../../ui";
import { uploadErrorText } from "../uploadAsset";
import {
  BUSY_TITLE,
  PREPARING_TITLE,
  VIDEO_KINDS,
  type AdFeature,
  type AdParams,
  type AdRunProps,
} from "./adsConfig";
import { AdsModelPicker } from "./AdsModelPicker";
import type { PhotoSlot } from "./usePhotoSlot";
import { videoDurationS, videoModelsForAds } from "./videoModels";
import flowStyles from "../flow.module.css";
import styles from "./ads.module.css";

type Props = AdRunProps & { photo: PhotoSlot };

export function VideoPanel({ photo, running, active, onRun }: Props) {
  const [kind, setKind] = useState("ugc");
  const [script, setScript] = useState("");
  const [modelId, setModelId] = useState(() => videoModelsForAds()[0]?.id ?? "");
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState("");

  const selected = videoModelsForAds().find((model) => model.id === modelId);
  const seconds = videoDurationS(selected);
  const hasScript = script.trim() !== "";
  let disabledTitle: string | undefined;
  if (!hasScript) {
    disabledTitle = "Write the script first";
  } else if (!selected) {
    disabledTitle = "No video model in the registry serves ads";
  } else if (running) {
    disabledTitle = BUSY_TITLE;
  } else if (preparing) {
    disabledTitle = PREPARING_TITLE;
  }

  async function generate() {
    if (!hasScript || !selected || running || preparing) {
      return;
    }
    setPreparing(true);
    setProblem("");
    try {
      // A product photo is composed into the scene before the clip runs; without one the graph
      // is a plain text-to-video run and places no product.
      const imageName = await photo.resolveName();
      const feature: AdFeature = kind === "unboxing" || kind === "tutorial" ? kind : "ugc";
      const label = VIDEO_KINDS.find((entry) => entry.value === feature)?.label ?? feature;
      const params: AdParams = imageName === undefined ? {} : { imageName };
      onRun({
        panel: "video",
        feature,
        modelId: selected.id,
        prompt: `${label} video (${seconds} s)${imageName ? ", product placement" : ""}: ${script.trim()}`,
        durationS: seconds,
        params,
      });
    } catch (cause) {
      setProblem(uploadErrorText(cause));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Panel
      title="UGC, unboxing and tutorial"
      subtitle={`A script becomes a ${seconds}-second clip on ${selected?.name ?? "the selected video model"}.`}
    >
      <div className={styles.stack}>
        <Segmented label="Video kind" value={kind} options={VIDEO_KINDS} onChange={setKind} />
        <div className={styles.fieldGroup}>
          <span className={styles.controlLabel}>Video model</span>
          <AdsModelPicker
            kind="video"
            durationS={videoDurationS(selected)}
            value={selected?.id ?? ""}
            onChange={setModelId}
          />
        </div>
        <TextArea label="Script" hint="What the person says or does." value={script} onChange={setScript} placeholder="Open the box, hold up the bottle, and say what it is for." rows={4} />
        <Dropzone label="Product photo" hint="Optional: the product is composed into the scene before the clip runs." accept="image/*" onFile={photo.take} fileName={photo.photo?.file.name} previewUrl={photo.photo?.url} />
        {photo.error ? <p className={flowStyles.error}>{photo.error}</p> : null}
        {problem ? <p className={flowStyles.error}>{problem}</p> : null}
        <p className={styles.note}>
          With a product photo the run composes the product into the script&apos;s scene, then
          animates that still. Without one it is text-to-video and cannot place a product.
        </p>
        <Button wide onClick={generate} disabled={!hasScript || !selected || running || preparing} loading={active || preparing} title={disabledTitle}>
          Generate
        </Button>
      </div>
    </Panel>
  );
}
