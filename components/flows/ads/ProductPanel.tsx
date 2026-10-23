"use client";

import { useId, useState } from "react";
import { Button, Dropzone, Field, Panel, Segmented } from "../../ui";
import { uploadErrorText } from "../uploadAsset";
import type { PhotoSlot } from "./usePhotoSlot";
import {
  BUSY_TITLE,
  PREPARING_TITLE,
  PRODUCT_FORMATS,
  STILL_DURATION_S,
  type AdParams,
  type AdRunProps,
} from "./adsConfig";
import flowStyles from "../flow.module.css";
import styles from "./ads.module.css";

type Props = AdRunProps & { modelId: string; photo: PhotoSlot };

function isWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Fetch a product URL through the server's guarded importer; it answers with the asset name. */
async function importProductImage(url: string): Promise<string> {
  const response = await fetch("/api/import-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  let body: { name?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as { name?: unknown; error?: unknown };
  } catch {
    // Not JSON; the status line below still says what happened.
  }
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  }
  if (typeof body.name !== "string" || body.name.trim() === "") {
    throw new Error("the import route returned no asset name");
  }
  return body.name;
}

export function ProductPanel({ modelId, photo, running, active, onRun }: Props) {
  const [productUrl, setProductUrl] = useState("");
  const [format, setFormat] = useState("1:1");
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState("");
  const urlFieldId = useId();
  const trimmedUrl = productUrl.trim();
  const urlInvalid = trimmedUrl !== "" && !isWebUrl(trimmedUrl);
  const hasPhoto = photo.photo !== undefined;
  const hasProduct = trimmedUrl !== "" || hasPhoto;
  const canMake = hasProduct && !urlInvalid;
  let disabledTitle: string | undefined;
  if (!hasProduct) {
    disabledTitle = "Add a product URL or a product photo first";
  } else if (urlInvalid) {
    disabledTitle = "Enter a full http(s) URL, or clear it";
  } else if (running) {
    disabledTitle = BUSY_TITLE;
  } else if (preparing) {
    disabledTitle = PREPARING_TITLE;
  }

  async function makeAd() {
    if (!canMake || running || preparing) {
      return;
    }
    setPreparing(true);
    setProblem("");
    try {
      // The photo wins when both are given; the URL is only fetched when there is no photo.
      const imageName = hasPhoto ? await photo.resolveName() : await importProductImage(trimmedUrl);
      if (imageName === undefined) {
        return;
      }
      const params: AdParams = { format, imageName };
      if (!hasPhoto) {
        params.productUrl = trimmedUrl;
      }
      const source = hasPhoto
        ? `the product photo ${photo.photo?.file.name ?? ""}`.trim()
        : trimmedUrl;
      onRun({
        panel: "product",
        feature: "product",
        modelId,
        prompt: `product ad, ${format} format, for ${source}`,
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
    <Panel title="Product to ad" subtitle="A product URL or a photo becomes one still ad; either one is enough.">
      <div className={styles.stack}>
        <Field label="Product URL" hint="The server fetches this page when no photo is added." htmlFor={urlFieldId}>
          <input id={urlFieldId} className={styles.input} type="url" value={productUrl} placeholder="https://shop.example/item" onChange={(event) => setProductUrl(event.target.value)} />
        </Field>
        {urlInvalid ? (
          <p className={flowStyles.error}>Enter a full http(s) URL, or clear the field to use a photo.</p>
        ) : null}
        <Dropzone label="Product photo" hint="Click or drop an image" accept="image/*" onFile={photo.take} fileName={photo.photo?.file.name} previewUrl={photo.photo?.url} />
        {photo.error ? <p className={flowStyles.error}>{photo.error}</p> : null}
        <div className={styles.fieldGroup}>
          <span className={styles.controlLabel}>Format</span>
          <Segmented label="Format" value={format} options={PRODUCT_FORMATS} onChange={setFormat} />
        </div>
        {problem ? <p className={flowStyles.error}>{problem}</p> : null}
        <Button wide onClick={makeAd} disabled={!canMake || running || preparing} loading={active || preparing} title={disabledTitle}>
          Make ad
        </Button>
      </div>
    </Panel>
  );
}
