"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dropzone, Panel, Segmented } from "../../ui";
import { uploadAsset, uploadErrorText } from "../uploadAsset";
import { BUSY_TITLE, PREPARING_TITLE, SWAP_TARGETS, type FashionRunProps } from "./fashionConfig";
import flowStyles from "../flow.module.css";
import styles from "./fashion.module.css";

type UploadedImage = { file: File; url: string };

/** One image slot with its preview URL, kept alive until replaced or the page closes. */
function useImageSlot() {
  const [image, setImage] = useState<UploadedImage | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const current = useRef<UploadedImage | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (current.current) URL.revokeObjectURL(current.current.url);
    };
  }, []);

  function take(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(`${file.name} is not an image file.`);
      return;
    }
    if (current.current) URL.revokeObjectURL(current.current.url);
    const next = { file, url: URL.createObjectURL(file) };
    current.current = next;
    setImage(next);
    setError(undefined);
  }

  return { image, error, take };
}

export function SwapPanel({ running, active, onRun }: FashionRunProps) {
  const garment = useImageSlot();
  const modelPhoto = useImageSlot();
  const [target, setTarget] = useState("both");
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState("");
  const canSwap = garment.image !== undefined && modelPhoto.image !== undefined;
  let disabledTitle: string | undefined;
  if (!garment.image) {
    disabledTitle = "Add a garment photo first";
  } else if (!modelPhoto.image) {
    disabledTitle = "Add a model or person photo first";
  } else if (preparing) {
    disabledTitle = PREPARING_TITLE;
  } else if (running) {
    disabledTitle = BUSY_TITLE;
  }

  async function swap() {
    const garmentImage = garment.image;
    const modelImage = modelPhoto.image;
    if (!garmentImage || !modelImage || running || preparing) return;
    setPreparing(true);
    setProblem("");
    try {
      // Both photos go to the asset store; the graph reads the garment first and the model second.
      const [imageName, endImageName] = await Promise.all([
        uploadAsset(garmentImage.file),
        uploadAsset(modelImage.file),
      ]);
      const label = target === "both" ? "garment and model" : target;
      onRun({
        feature: "swap",
        prompt: `swap the ${label} in the shot`,
        params: { target, imageName, endImageName },
      });
    } catch (cause) {
      setProblem(uploadErrorText(cause));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Panel title="Garment and model swap" subtitle="Two photos in, one swapped still out.">
      <div className={styles.stack}>
        <div className={styles.uploads}>
          <Dropzone label="Garment photo" hint="Click or drop an image" accept="image/*" onFile={garment.take} fileName={garment.image?.file.name} previewUrl={garment.image?.url} />
          <Dropzone label="Model or person photo" hint="Click or drop an image" accept="image/*" onFile={modelPhoto.take} fileName={modelPhoto.image?.file.name} previewUrl={modelPhoto.image?.url} />
        </div>
        {garment.error ? <p className={flowStyles.error}>{garment.error}</p> : null}
        {modelPhoto.error ? <p className={flowStyles.error}>{modelPhoto.error}</p> : null}
        <div className={styles.fieldGroup}>
          <span className={styles.controlLabel}>Swap</span>
          <Segmented label="Swap target" value={target} options={SWAP_TARGETS} onChange={setTarget} />
        </div>
        {problem ? <p className={flowStyles.error}>{problem}</p> : null}
        <Button wide onClick={swap} disabled={!canSwap || running || preparing} loading={active || preparing} title={disabledTitle}>
          Swap
        </Button>
      </div>
    </Panel>
  );
}
