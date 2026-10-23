"use client";

import { useEffect, useRef, useState } from "react";
import { defaultModelForMode, findModel } from "../../../lib/models";
import { Button, Dropzone, Panel, Slider, TextArea, useJob } from "../../ui";
import { ModelPicker, ResultStage } from "../index";
import { uploadAsset, uploadErrorText } from "../uploadAsset";
import flowStyles from "../flow.module.css";
import styles from "./edit.module.css";

type SourceClip = { file: File; url: string };

const MIN_SOURCE_S = 1;
const MAX_SOURCE_S = 30;
const MIN_DURATION_S = 1;
const MAX_DURATION_S = 30;
const MIN_STRENGTH = 1;
const MAX_STRENGTH = 10;
const DEFAULT_STRENGTH = 5;
const EMPTY_TITLE = "Nothing to edit yet";
const EMPTY_BODY =
  "Load a finished clip, describe the change, then generate. Without COMFY_URL the run returns a demo poster, not a rendered video.";
const PROMPT_PLACEHOLDER = "What should change? Keep the rest of the shot intact.";

function formatSeconds(seconds: number): string {
  return `${Math.round(seconds * 10) / 10}s`;
}

/** The longest whole-second request a clip can honour: its own length, never past its end. */
function clipMaxS(clipDurationS: number | undefined, modelMaxS: number, minS: number): number {
  if (clipDurationS === undefined) return modelMaxS;
  return Math.min(modelMaxS, Math.max(Math.floor(clipDurationS), minS));
}

/** The prompt sent to the model: the requested change, with the shot locked around it. */
function composeEditPrompt(prompt: string): string {
  return `edit the clip: ${prompt.trim()}. Keep the framing, camera and timing; change only what the prompt asks`;
}

export function EditFlow() {
  const [clip, setClip] = useState<SourceClip | undefined>(undefined);
  const [clipDurationS, setClipDurationS] = useState<number | undefined>(undefined);
  const [clipReadable, setClipReadable] = useState<boolean | undefined>(undefined);
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [modelId, setModelId] = useState(() => defaultModelForMode("edit").id);
  const [requestedS, setRequestedS] = useState(MIN_DURATION_S);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const { job, error, running, submit } = useJob("edit");
  const clipRef = useRef<SourceClip | undefined>(undefined);

  const model = findModel(modelId) ?? defaultModelForMode("edit");
  const maxDurationS = Math.min(MAX_DURATION_S, model.maxDurationS);
  const minDurationS = Math.min(MIN_DURATION_S, maxDurationS);
  const requestMaxS = clipMaxS(clipDurationS, maxDurationS, minDurationS);
  const durationS = Math.min(Math.max(requestedS, minDurationS), requestMaxS);
  const clipInRange =
    clipDurationS !== undefined && clipDurationS >= MIN_SOURCE_S && clipDurationS <= MAX_SOURCE_S;
  const unreadable = clip !== undefined && clipReadable === false;
  const hasPrompt = prompt.trim() !== "";
  const canGenerate = clip !== undefined && clipInRange && !unreadable && hasPrompt;

  let disabledTitle: string | undefined;
  if (!clip) {
    disabledTitle = "Add a source clip first";
  } else if (!hasPrompt) {
    disabledTitle = "Describe the edit first";
  } else if (unreadable) {
    disabledTitle = "Could not read the clip length";
  } else if (clipDurationS === undefined) {
    disabledTitle = "Reading the clip length";
  } else if (!clipInRange) {
    disabledTitle = "Source clips run 1–30 seconds";
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
    setUploading(true);
    setUploadError(undefined);
    try {
      const videoName = await uploadAsset(clip.file);
      submit({
        mode: "edit",
        modelId,
        prompt: composeEditPrompt(prompt),
        durationS,
        params: { strength, sourceDurationS: clipDurationS, videoName },
      });
    } catch (cause) {
      setUploadError(uploadErrorText(cause));
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Revision</span>
        <h1>Edit</h1>
        <p className={flowStyles.lead}>
          Take a finished clip, describe the change, and re-render it. The framing, camera and timing
          stay as they are. The clip is uploaded with the request, so the server re-renders the real
          footage rather than a prompt alone.
        </p>
      </header>

      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <Panel title="Source clip" subtitle="1 to 30 seconds. This is the clip that gets edited.">
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
                Source clips run 1–30 seconds; this one is {formatSeconds(clipDurationS)}.
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
                  if (readable) {
                    const cap = clipMaxS(duration, maxDurationS, minDurationS);
                    setRequestedS(Math.min(Math.max(Math.floor(duration), minDurationS), cap));
                  }
                }}
                onError={() => {
                  setClipDurationS(undefined);
                  setClipReadable(false);
                }}
              />
            ) : null}
          </Panel>

          <Panel title="Prompt" subtitle="Say what changes. Everything you leave out stays as it was.">
            <TextArea
              label="Prompt"
              hint="One clear change works better than several."
              value={prompt}
              onChange={setPrompt}
              placeholder={PROMPT_PLACEHOLDER}
              rows={4}
            />
          </Panel>

          <Panel title="Model" subtitle={`Runs are clamped to ${model.maxDurationS}s on ${model.name}.`}>
            <div className={styles.stack}>
              <ModelPicker mode="edit" value={modelId} durationS={durationS} onChange={setModelId} />
              <Slider
                label="Requested length"
                value={durationS}
                min={minDurationS}
                max={requestMaxS}
                step={1}
                unit="s"
                onChange={setRequestedS}
              />
              <p className={styles.clipMeta}>
                <span>Effective duration</span>
                <span className={styles.clipLength}>
                  {formatSeconds(durationS)}
                  {requestedS !== durationS ? ` (clamped from ${formatSeconds(requestedS)})` : ""}
                </span>
              </p>
              {clipDurationS !== undefined && clipDurationS > maxDurationS ? (
                <p className={styles.clipMeta}>
                  <span>Source is {formatSeconds(clipDurationS)}</span>
                  <span>{formatSeconds(maxDurationS)} max on {model.name}</span>
                </p>
              ) : null}
              <Slider
                label="Edit strength"
                value={strength}
                min={MIN_STRENGTH}
                max={MAX_STRENGTH}
                step={1}
                unit="/10"
                onChange={setStrength}
              />
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
          <div className={flowStyles.actions}>
            <Button wide onClick={generate} disabled={!canGenerate} loading={running || uploading} title={disabledTitle}>
              Generate
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
