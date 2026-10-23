"use client";

import { useEffect, useRef, useState } from "react";
import { defaultModelForMode, findModel } from "../../../lib/models";
import { Button, Chip, Dropzone, Panel, Slider, useJob } from "../../ui";
import { ModelPicker, ReferenceTray, ResultStage, type ReferenceItem } from "../index";
import { uploadAsset, uploadErrorText } from "../uploadAsset";
import flowStyles from "../flow.module.css";
import { CharacterCard, DEFAULT_CHARACTER_NAME } from "./CharacterCard";
import styles from "./genjutsu.module.css";

type Operation = "motion" | "swap";
type SourceClip = { file: File; url: string };

const MIN_SOURCE_S = 4;
const MAX_SOURCE_S = 30;
const MIN_DURATION_S = 4;
const MAX_DURATION_S = 30;
const MAX_REFS = 30;
const EMPTY_TITLE = "Nothing to transform yet";
const EMPTY_BODY = "Load a source clip, pick motion transfer or object swap, then generate. Without COMFY_URL the run returns a demo poster, not a rendered video.";

function formatSeconds(seconds: number): string {
  return `${Math.round(seconds * 10) / 10}s`;
}

/** The prompt written when no prompt is given: what to keep and what to rebuild. */
function composePrompt(operation: Operation, character: string, emotions: string[]): string {
  const mood =
    emotions.length > 0
      ? ` with ${emotions.map((emotion) => `@${character} ${emotion}`).join(", ")}`
      : "";
  return operation === "motion"
    ? `transfer the motion, camera and timing of the source clip onto ${character}${mood}, rebuilding the scene from the character references`
    : `swap the subject in the source clip for ${character}${mood}, keeping the rest of the shot, its camera and timing unchanged`;
}

export function GenjutsuFlow() {
  const [operation, setOperation] = useState<Operation>("motion");
  const [clip, setClip] = useState<SourceClip | undefined>(undefined);
  const [clipDurationS, setClipDurationS] = useState<number | undefined>(undefined);
  const [clipReadable, setClipReadable] = useState<boolean | undefined>(undefined);
  const [objectRefs, setObjectRefs] = useState<ReferenceItem[]>([]);
  const [name, setName] = useState("");
  const [identityRefs, setIdentityRefs] = useState<ReferenceItem[]>([]);
  const [emotions, setEmotions] = useState<string[]>([]);
  const [modelId, setModelId] = useState(() => defaultModelForMode("genjutsu").id);
  const [requestedS, setRequestedS] = useState(MIN_DURATION_S);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const { job, error, running, submit } = useJob("genjutsu");
  const clipRef = useRef<SourceClip | undefined>(undefined);

  const model = findModel(modelId) ?? defaultModelForMode("genjutsu");
  const maxDurationS = Math.min(MAX_DURATION_S, model.maxDurationS);
  const minDurationS = Math.min(MIN_DURATION_S, maxDurationS);
  const durationS = Math.min(Math.max(requestedS, minDurationS), maxDurationS);
  const clipInRange = clipDurationS !== undefined && clipDurationS >= MIN_SOURCE_S && clipDurationS <= MAX_SOURCE_S;
  const unreadable = clip !== undefined && clipReadable === false;
  const visibleObjectRefs = operation === "swap" ? objectRefs : [];
  const refCount = identityRefs.length + visibleObjectRefs.length;
  const identityRoom = MAX_REFS - visibleObjectRefs.length;
  const objectRoom = MAX_REFS - identityRefs.length;
  const needsObjectRefs = operation === "swap" && objectRefs.length === 0;
  const canGenerate = clip !== undefined && clipInRange && !unreadable && !needsObjectRefs;

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

  function chooseOperation(next: Operation) {
    setOperation(next);
    if (next === "motion") {
      setObjectRefs([]);
    }
  }

  async function generate() {
    if (!canGenerate || running || uploading || !clip || clipDurationS === undefined) return;
    const character = name.trim() || DEFAULT_CHARACTER_NAME;
    setUploading(true);
    setUploadError(undefined);
    try {
      const videoName = await uploadAsset(clip.file);
      submit({
        mode: "genjutsu",
        modelId,
        prompt: composePrompt(operation, character, emotions),
        durationS,
        params: {
          operation,
          character,
          emotions: emotions.join("|"),
          sourceDurationS: clipDurationS,
          refCount,
          videoName,
        },
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
        <span className={flowStyles.kicker}>Transformation</span>
        <h1>Genjutsu</h1>
        <p className={flowStyles.lead}>Lift a performance from a source clip onto a character card, or swap one object in the shot.</p>
      </header>
      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <Panel title="Operation" subtitle="Keep the performance, or replace one thing in the shot.">
            <div className={styles.operations} role="group" aria-label="Operation">
              <Chip active={operation === "motion"} onClick={() => chooseOperation("motion")}>Motion transfer</Chip>
              <Chip active={operation === "swap"} onClick={() => chooseOperation("swap")}>Object swap</Chip>
            </div>
          </Panel>
          <Panel title="Source clip" subtitle="4 to 30 seconds. Motion and timing come from this clip.">
            <Dropzone label="Drop a source clip" hint="Click or drop a video" accept="video/*" onFile={takeSource} fileName={clip?.file.name} />
            {clip ? (
              <p className={styles.clipMeta}>
                <span>Source length</span>
                <span className={styles.clipLength}>{unreadable ? "unreadable" : clipDurationS === undefined ? "reading…" : formatSeconds(clipDurationS)}</span>
              </p>
            ) : null}
            {unreadable ? (
              <p className={flowStyles.error}>Could not read the clip length. Try another video file.</p>
            ) : null}
            {clipDurationS !== undefined && !clipInRange ? (
              <p className={flowStyles.error}>Source clips run 4–30 seconds; this one is {formatSeconds(clipDurationS)}.</p>
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
          {operation === "swap" ? (
            <Panel title="Object references" subtitle="Shares the 30-image budget with the character card.">
              <ReferenceTray max={objectRoom} items={objectRefs} onChange={setObjectRefs} label="Object references" hint="At least one reference is required for a swap." />
            </Panel>
          ) : null}
          <CharacterCard name={name} onName={setName} refs={identityRefs} onRefs={setIdentityRefs} emotions={emotions} onEmotions={setEmotions} maxRefs={identityRoom} />
          <Panel title="Model" subtitle={`Runs are clamped to ${model.maxDurationS}s on ${model.name}.`}>
            <div className={styles.stack}>
              <ModelPicker mode="genjutsu" value={modelId} durationS={durationS} onChange={setModelId} />
              <Slider label="Requested length" value={durationS} min={minDurationS} max={maxDurationS} step={1} unit="s" onChange={setRequestedS} />
              <p className={styles.clipMeta}>
                <span>Effective duration</span>
                <span className={styles.clipLength}>{formatSeconds(durationS)}{requestedS !== durationS ? ` (clamped from ${formatSeconds(requestedS)})` : ""}</span>
              </p>
            </div>
          </Panel>
        </div>

        <div className={flowStyles.stage}>
          <ResultStage job={job} error={uploadError ?? error} running={running || uploading} emptyTitle={EMPTY_TITLE} emptyBody={EMPTY_BODY} />
          <div className={flowStyles.actions}>
            <Button wide onClick={generate} disabled={!canGenerate} loading={running || uploading} title={!clip ? "Add a source clip first" : unreadable ? "Could not read the clip length" : clipDurationS === undefined ? "Reading the clip length" : !clipInRange ? "Source clips run 4–30 seconds" : needsObjectRefs ? "Add at least one object reference" : undefined}>
              Generate
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
