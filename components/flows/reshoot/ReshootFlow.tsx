"use client";

import { useEffect, useRef, useState } from "react";
import { defaultModelForMode, findModel } from "../../../lib/models";
import { Button, Chip, Dropzone, Panel, Slider, TextArea, useJob } from "../../ui";
import { ModelPicker, ResultStage } from "../index";
import { uploadAsset, uploadErrorText } from "../uploadAsset";
import flowStyles from "../flow.module.css";
import styles from "./reshoot.module.css";

type CameraSetting = {
  orbit: number;
  tilt: number;
  zoom: number;
  roll: number;
};

type AnglePreset = {
  id: string;
  label: string;
  angle: string;
  camera: CameraSetting;
};

/** A preset is a starting point; every slider stays editable after it is applied. */
const PRESETS = [
  {
    id: "front",
    label: "Front",
    angle: "a front-on angle",
    camera: { orbit: 0, tilt: 0, zoom: 1, roll: 0 },
  },
  {
    id: "three-quarter",
    label: "Three-quarter",
    angle: "a three-quarter angle",
    camera: { orbit: 30, tilt: 5, zoom: 1.15, roll: 0 },
  },
  {
    id: "profile",
    label: "Profile",
    angle: "a profile angle",
    camera: { orbit: 45, tilt: 0, zoom: 1.1, roll: 0 },
  },
  {
    id: "low-angle",
    label: "Low angle",
    angle: "a low angle",
    camera: { orbit: 0, tilt: -20, zoom: 1.15, roll: 0 },
  },
  {
    id: "high-angle",
    label: "High angle",
    angle: "a high angle",
    camera: { orbit: 0, tilt: 20, zoom: 1.15, roll: 0 },
  },
  {
    id: "overhead",
    label: "Overhead",
    angle: "an overhead angle",
    camera: { orbit: 0, tilt: 30, zoom: 1.3, roll: 0 },
  },
] as const satisfies readonly AnglePreset[];

const DEFAULT_PRESET = PRESETS[0];

/** Re-shoots are stills, so the run is always one second; the model cap still applies. */
const REQUESTED_DURATION_S = 1;

const EMPTY_TITLE = "Drop a still to re-shoot";
const EMPTY_BODY =
  "Choose an angle preset or move orbit, tilt, zoom and roll yourself, then generate. The subject stays put while the camera moves around it.";

/** The sliders no longer match any preset after one moves; the prompt says so instead. */
const CUSTOM_PRESET_ID = "custom";

function findPreset(id: string): AnglePreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** The prompt the flow writes when the field is empty: the angle plus the four camera values. */
function composePrompt(angle: string, camera: CameraSetting): string {
  return `re-shoot the same subject from ${angle} (orbit ${camera.orbit}°, tilt ${camera.tilt}°, zoom ${camera.zoom}×, roll ${camera.roll}°), keep the subject and background unchanged`;
}

type SourceStill = {
  file: File;
  previewUrl: string;
};

export function ReshootFlow() {
  const [source, setSource] = useState<SourceStill | undefined>(undefined);
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET.id);
  const [camera, setCamera] = useState<CameraSetting>(DEFAULT_PRESET.camera);
  const [modelId, setModelId] = useState(() => defaultModelForMode("reshoot").id);
  const [prompt, setPrompt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const { job, error, running, submit, reset } = useJob("reshoot");
  const sourceRef = useRef<SourceStill | undefined>(undefined);

  const preset = findPreset(presetId);
  const model = findModel(modelId) ?? defaultModelForMode("reshoot");
  const durationS = Math.min(REQUESTED_DURATION_S, model.maxDurationS);

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        URL.revokeObjectURL(sourceRef.current.previewUrl);
      }
    };
  }, []);

  function takeSource(file: File) {
    const next = { file, previewUrl: URL.createObjectURL(file) };
    if (sourceRef.current) {
      URL.revokeObjectURL(sourceRef.current.previewUrl);
    }
    sourceRef.current = next;
    setSource(next);
  }

  function choosePreset(next: AnglePreset) {
    setPresetId(next.id);
    setCamera(next.camera);
  }

  function moveCamera(patch: Partial<CameraSetting>) {
    setCamera((current) => ({ ...current, ...patch }));
    setPresetId(CUSTOM_PRESET_ID);
  }

  async function generate() {
    if (!source || running || uploading) {
      return;
    }

    setUploading(true);
    setUploadError(undefined);
    try {
      const imageName = await uploadAsset(source.file);
      submit({
        mode: "reshoot",
        modelId,
        prompt: prompt.trim() || composePrompt(preset ? preset.angle : "a custom angle", camera),
        durationS,
        params: {
          preset: preset?.id ?? CUSTOM_PRESET_ID,
          orbit: camera.orbit,
          tilt: camera.tilt,
          zoom: camera.zoom,
          roll: camera.roll,
          imageName,
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
        <span className={flowStyles.kicker}>New angle</span>
        <h1>Re-shoot</h1>
        <p className={flowStyles.lead}>
          Load a still and move the camera around it. Pick an angle or set orbit, tilt, zoom and roll
          by hand; the subject and background stay as they are.
        </p>
      </header>

      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <Panel title="Source" subtitle="One still. The camera moves around the scene.">
            <Dropzone
              label="Drop a still"
              hint="Click or drop an image"
              accept="image/*"
              onFile={takeSource}
              fileName={source?.file.name}
              previewUrl={source?.previewUrl}
            />
          </Panel>

          <Panel title="Camera" subtitle="Start from an angle, then fine-tune.">
            <div className={styles.presets}>
              {PRESETS.map((entry) => (
                <Chip
                  key={entry.id}
                  active={entry.id === presetId}
                  onClick={() => choosePreset(entry)}
                >
                  {entry.label}
                </Chip>
              ))}
            </div>
            <div className={styles.sliders}>
              <Slider
                label="Orbit"
                value={camera.orbit}
                min={-45}
                max={45}
                step={1}
                unit="°"
                onChange={(orbit) => moveCamera({ orbit })}
              />
              <Slider
                label="Tilt"
                value={camera.tilt}
                min={-30}
                max={30}
                step={1}
                unit="°"
                onChange={(tilt) => moveCamera({ tilt })}
              />
              <Slider
                label="Zoom"
                value={camera.zoom}
                min={1}
                max={2}
                step={0.05}
                unit="×"
                onChange={(zoom) => moveCamera({ zoom })}
              />
              <Slider
                label="Roll"
                value={camera.roll}
                min={-15}
                max={15}
                step={1}
                unit="°"
                onChange={(roll) => moveCamera({ roll })}
              />
            </div>
          </Panel>

          <Panel title="Model" subtitle="Runs at 1s, clamped to the model's limit.">
            <ModelPicker
              mode="reshoot"
              value={modelId}
              durationS={durationS}
              onChange={setModelId}
            />
          </Panel>

          <Panel
            title="Prompt"
            subtitle="Optional. An empty prompt is written from the angle and sliders."
          >
            <TextArea
              label="Prompt"
              value={prompt}
              onChange={setPrompt}
              placeholder="re-shoot the same subject from a low angle, keep the subject and background unchanged"
              rows={4}
            />
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
            <Button wide onClick={generate} disabled={!source} loading={running || uploading}>
              Generate
            </Button>
            {job ? (
              <Button variant="ghost" wide onClick={reset} title="Clear the current run and result">
                Reset
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
