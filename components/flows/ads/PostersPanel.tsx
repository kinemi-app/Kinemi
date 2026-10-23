"use client";

import { useState } from "react";
import { Button, Chip, Dropzone, Panel, Segmented } from "../../ui";
import { uploadErrorText } from "../uploadAsset";
import type { PhotoSlot } from "./usePhotoSlot";
import {
  BUSY_TITLE,
  POSTER_SIZES,
  PREPARING_TITLE,
  STILL_DURATION_S,
  type AdParams,
  type AdRunProps,
} from "./adsConfig";
import flowStyles from "../flow.module.css";
import styles from "./ads.module.css";

type Props = AdRunProps & { modelId: string; photo: PhotoSlot };

export function PostersPanel({ modelId, photo, running, active, onRun }: Props) {
  const [size, setSize] = useState("square");
  const [motion, setMotion] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState("");
  const hasPhoto = photo.photo !== undefined;
  let disabledTitle: string | undefined;
  if (running) {
    disabledTitle = BUSY_TITLE;
  } else if (preparing) {
    disabledTitle = PREPARING_TITLE;
  }

  async function render() {
    if (running || preparing) {
      return;
    }
    setPreparing(true);
    setProblem("");
    try {
      // The shared product photo is optional here; a poster without one is a plain still.
      const imageName = hasPhoto ? await photo.resolveName() : undefined;
      const params: AdParams = { size, motion };
      if (imageName !== undefined) {
        params.imageName = imageName;
      }
      onRun({
        panel: "posters",
        feature: "posters",
        modelId,
        prompt: `marketplace poster, ${size} format${motion ? ", motion graphics" : ""}`,
        durationS: STILL_DURATION_S,
        params,
      });
    } catch (cause) {
      setProblem(uploadErrorText(cause));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Panel title="Marketplace and posters" subtitle="A square, portrait or story poster for a listing.">
      <div className={styles.stack}>
        <Dropzone
          label="Product photo"
          hint="Optional: puts this product in the poster"
          accept="image/*"
          onFile={photo.take}
          fileName={photo.photo?.file.name}
          previewUrl={photo.photo?.url}
        />
        {photo.error ? <p className={flowStyles.error}>{photo.error}</p> : null}
        <div className={styles.fieldGroup}>
          <span className={styles.controlLabel}>Size</span>
          <Segmented label="Size" value={size} options={POSTER_SIZES} onChange={setSize} />
        </div>
        <div className={styles.chips} role="group" aria-label="Poster options">
          <Chip active={motion} onClick={() => setMotion(!motion)} title="Add motion graphics to the poster">Motion graphics</Chip>
        </div>
        {problem ? <p className={flowStyles.error}>{problem}</p> : null}
        <Button wide onClick={render} disabled={running || preparing} loading={active || preparing} title={disabledTitle}>
          Render posters
        </Button>
      </div>
    </Panel>
  );
}
