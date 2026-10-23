"use client";

import { useEffect, useRef, useState } from "react";
import { defaultModelForMode, findModel } from "../../../lib/models";
import { Button, Dropzone, Panel, Segmented, Slider, useJob } from "../../ui";
import { ModelPicker, ResultStage } from "../index";
import flowStyles from "../flow.module.css";
import styles from "./upscale.module.css";
import { uploadAsset } from "./upload";

type SourceClip = { file: File; url: string };

const MIN_SOURCE_S = 1;
const MAX_SOURCE_S = 60;
const DEFAULT_FACTOR = "4";
const DEFAULT_FPS = "60";
const FPS_60 = "60";
const DEFAULT_DEFLICKER = 0;
const MAX_DEFLICKER = 10;
const FACTOR_OPTIONS = [{ value: "2", label: "2x" }, { value: "4", label: "4x" }];
const FPS_OPTIONS = [{ value: "30", label: "30 fps" }, { value: "60", label: "60 fps" }];
const EMPTY_TITLE = "Add a clip to upscale";
const EMPTY_BODY =
  "Pick the upscale factor, the frame rate and deflicker, then run. Without COMFY_URL the run returns a demo poster, not a rendered clip.";

function formatSeconds(seconds: number): string {
  return `${Math.round(seconds * 10) / 10}s`;
}

/** The prompt sent to the model: the settings in words, with the shot itself locked. */
function composeUpscalePrompt(factor: string, fps: string, deflicker: number): string {
  const rate = fps === FPS_60 ? "interpolate to 60 fps" : "keep 30 fps";
  const smooth = deflicker > 0 ? `, deflicker ${deflicker}/10` : "";
  return `upscale the clip ${factor}x, ${rate}${smooth}; keep the source timing and framing`;
}

export function UpscaleFlow() {
  const [clip, setClip] = useState<SourceClip | undefined>(undefined);
  const [clipDurationS, setClipDurationS] = useState<number | undefined>(undefined);
  const [clipReadable, setClipReadable] = useState<boolean | undefined>(undefined);
  const [factor, setFactor] = useState(DEFAULT_FACTOR);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [deflicker, setDeflicker] = useState(DEFAULT_DEFLICKER);
  const [modelId, setModelId] = useState(() => defaultModelForMode("upscale").id);
  const { job, error, running, submit } = useJob("upscale");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const clipRef = useRef<SourceClip | undefined>(undefined);

  const model = findModel(modelId) ?? defaultModelForMode("upscale");
  const durationS =
    clipDurationS === undefined ? MIN_SOURCE_S : Math.min(clipDurationS, model.maxDurationS);
  const clipInRange =
    clipDurationS !== undefined && clipDurationS >= MIN_SOURCE_S && clipDurationS <= MAX_SOURCE_S;
  const unreadable = clip !== undefined && clipReadable === false;
  const canGenerate = clip !== undefined && clipInRange && !unreadable && clipDurationS !== undefined;

  let disabledTitle: string | undefined;
  if (uploading) {
    disabledTitle = "Uploading the source clip";
  } else if (!clip) {
    disabledTitle = "Add a source clip first";
  } else if (unreadable) {
    disabledTitle = "Could not read the clip length";
  } else if (clipDurationS === undefined) {
    disabledTitle = "Reading the clip length";
  } else if (!clipInRange) {
    disabledTitle = "Source clips run 1-60 seconds";
  }

  useEffect(() => {
    return () => {
      if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
    };
  }, []);

  function takeSource(file: File) {
    if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
    const next = { file, url: URL.createObjectURL(file) };
    clipRef.current = next;
    setClip(next);
    setClipDurationS(undefined);
    setClipReadable(undefined);
  }

  async function generate() {
    if (!canGenerate || running || uploading || clipDurationS === undefined || !clip) return;
    setUploadError(undefined);
    setUploading(true);
    try {
      const videoName = await uploadAsset(clip.file);
      submit({
        mode: "upscale",
        modelId,
        prompt: composeUpscalePrompt(factor, fps, deflicker),
        durationS,
        params: {
          factor: Number(factor),
          fps: Number(fps),
          deflicker,
          sourceDurationS: clipDurationS,
          videoName,
        },
      });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "the upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Finishing</span>
        <h1>Upscale</h1>
        <p className={flowStyles.lead}>
          Take a clip to a larger frame size, add frames up to 60 fps and smooth flicker. The clip sets
          the length; the request carries the settings, not the file bytes.
        </p>
      </header>

      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <Panel title="Source clip" subtitle="1 to 60 seconds. This is the clip that gets upscaled.">
            <Dropzone
              label="Drop a source clip"
              hint="Click or drop a video"
              accept="video/*"
              onFile={takeSource}
              fileName={clip?.file.name}
            />
            {clip ? (
              <p className={styles.clipMeta}>
                <span>Source length</span>
                <span className={styles.clipLength}>
                  {unreadable ? "unreadable" : clipDurationS === undefined ? "reading…" : formatSeconds(clipDurationS)}
                </span>
              </p>
            ) : null}
            {unreadable ? (
              <p className={flowStyles.error}>Could not read the clip length. Try another video file.</p>
            ) : null}
            {clipDurationS !== undefined && !clipInRange ? (
              <p className={flowStyles.error}>
                Source clips run 1-60 seconds; this one is {formatSeconds(clipDurationS)}.
              </p>
            ) : null}
            {clip ? (
              <video
                className={styles.probe}
                src={clip.url}
                preload="metadata"
                muted
                playsInline
                aria-hidden="true"
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  const readable = Number.isFinite(duration) && duration > 0;
                  setClipDurationS(readable ? duration : undefined);
                  setClipReadable(readable);
                }}
                onError={() => {
                  setClipDurationS(undefined);
                  setClipReadable(false);
                }}
              />
            ) : null}
          </Panel>

          <Panel title="4K upscale" subtitle="2x or 4x the source frame size.">
            <Segmented label="Factor" value={factor} options={FACTOR_OPTIONS} onChange={setFactor} />
          </Panel>

          <Panel
            title="60 fps interpolation"
            subtitle="30 fps keeps the source rate; 60 fps adds frames between them."
          >
            <Segmented label="Frame rate" value={fps} options={FPS_OPTIONS} onChange={setFps} />
          </Panel>

          <Panel title="Deflicker and restoration" subtitle="0 leaves the clip untouched.">
            <Slider
              label="Deflicker"
              value={deflicker}
              min={0}
              max={MAX_DEFLICKER}
              step={1}
              unit="/10"
              onChange={setDeflicker}
            />
          </Panel>

          <Panel title="Model" subtitle={`Runs are clamped to ${model.maxDurationS}s on ${model.name}.`}>
            <div className={styles.stack}>
              <ModelPicker mode="upscale" value={modelId} durationS={durationS} onChange={setModelId} />
            </div>
          </Panel>
        </div>

        <div className={flowStyles.stage}>
          <ResultStage
            job={job}
            error={uploadError ?? error}
            running={running || uploading}
            emptyTitle={EMPTY_TITLE}
            emptyBody={EMPTY_BODY}
          />
          <p className={styles.note}>Demo poster; the upscaled clip needs a Comfy deployment.</p>
          <div className={flowStyles.actions}>
            <Button
              wide
              onClick={generate}
              disabled={!canGenerate || uploading}
              loading={running || uploading}
              title={disabledTitle}
            >
              Upscale
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
