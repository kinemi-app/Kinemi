"use client";

import { useEffect, useId, useRef, useState } from "react";
import { defaultModelForMode, findModel } from "../../../lib/models";
import { cameraMoves, findCameraMove, lookBook } from "../../../lib/presets/load";
import { composePromptHelp } from "../../../lib/prompt/compose";
import type { CameraMove, LookOption } from "../../../lib/types";
import { Button, Chip, Dropzone, Field, Panel, TextArea, useJob } from "../../ui";
import { ModelPicker, ReferenceTray, ResultStage } from "../index";
import type { ReferenceItem } from "../index";
import { uploadAsset, uploadErrorText } from "../uploadAsset";
import flowStyles from "../flow.module.css";
import { PresetPicker } from "./PresetPicker";
import styles from "./cinematic.module.css";

/** The API's prompt ceiling: the composed fallback is capped here so a submit never trips it. */
const MAX_PROMPT_CHARS = 2000;

type LookChoice = {
  body: string;
  lens: string;
  aperture: string;
  palette: string;
  lighting: string;
};

type Frame = {
  file: File;
  previewUrl: string;
};

function firstId(options: readonly LookOption[]): string {
  return options[0]?.id ?? "";
}

const DEFAULT_LOOK: LookChoice = {
  body: firstId(lookBook.bodies),
  lens: firstId(lookBook.lenses),
  aperture: lookBook.apertures[0] ?? "",
  palette: firstId(lookBook.palettes),
  lighting: firstId(lookBook.lighting),
};

function lookName(options: readonly LookOption[], id: string): string | undefined {
  return options.find((option) => option.id === id)?.name;
}

/** The stacked ids in click order, with unknown ids dropped. */
function movesInOrder(ids: string[]): CameraMove[] {
  return ids.map(findCameraMove).filter((move): move is CameraMove => move !== undefined);
}

/** The look as the phrase a prompt ends on, or "" when none of its parts resolve. */
function lookPhrase(look: LookChoice): string {
  const lookParts: string[] = [];
  const body = lookName(lookBook.bodies, look.body);
  if (body) {
    lookParts.push(`${body} body`);
  }
  const lens = lookName(lookBook.lenses, look.lens);
  if (lens) {
    lookParts.push(`${lens} lens`);
  }
  if (look.aperture) {
    lookParts.push(`aperture ${look.aperture}`);
  }
  const palette = lookName(lookBook.palettes, look.palette);
  if (palette) {
    lookParts.push(`${palette} palette`);
  }
  const lighting = lookName(lookBook.lighting, look.lighting);
  if (lighting) {
    lookParts.push(`${lighting} lighting`);
  }
  return lookParts.length > 0 ? `shot on ${lookParts.join(", ")}` : "";
}

/**
 * The prompt the flow writes when the field is empty: the stacked moves in stack order, then the
 * look, as one sentence. Capped to the API's limit so the fallback can never be refused.
 */
function composePrompt(moves: CameraMove[], look: LookChoice): string {
  const lookPart = lookPhrase(look);
  const parts = [moves.map((move) => move.prompt).join(", then ")];
  if (lookPart !== "") {
    parts.push(lookPart);
  }
  const sentence = parts.filter((part) => part !== "").join(", ");
  return sentence === "" ? "" : `${sentence}.`.slice(0, MAX_PROMPT_CHARS);
}

type LookGroupProps = {
  label: string;
  options: LookOption[];
  value: string;
  onChange: (id: string) => void;
};

function LookGroup({ label, options, value, onChange }: LookGroupProps) {
  return (
    <div className={styles.lookGroup} role="group" aria-label={label}>
      <span className={styles.lookLabel}>{label}</span>
      <div className={styles.lookOptions}>
        {options.map((option) => (
          <Chip
            key={option.id}
            active={option.id === value}
            title={option.hint}
            onClick={() => onChange(option.id)}
          >
            {option.name}
          </Chip>
        ))}
      </div>
    </div>
  );
}

type PromptHelpProps = {
  idea: string;
  onIdeaChange: (idea: string) => void;
  moves: CameraMove[];
  look: LookChoice;
  onPrompt: (prompt: string) => void;
};

/**
 * The one-sentence helper: the written idea plus the stacked moves and the look, written into the
 * manual prompt field only when the writer asks for it.
 */
function PromptHelp({ idea, onIdeaChange, moves, look, onPrompt }: PromptHelpProps) {
  const ideaId = useId();

  function fillPrompt() {
    onPrompt(
      composePromptHelp(idea, {
        camera: moves.map((move) => move.prompt).join(", then "),
        look: lookPhrase(look),
      }),
    );
  }

  return (
    <Panel title="Prompt help" subtitle="One sentence: the moves and the look are added for you.">
      <Field label="Your idea" htmlFor={ideaId}>
        <input
          id={ideaId}
          className={styles.search}
          type="text"
          value={idea}
          placeholder="A lone lighthouse in heavy fog, slow push in"
          onChange={(event) => onIdeaChange(event.target.value)}
        />
      </Field>
      <div className={styles.frameActions}>
        <Button variant="ghost" onClick={fillPrompt} disabled={idea.trim() === ""}>
          Fill prompt
        </Button>
      </div>
    </Panel>
  );
}

/**
 * One drop slot for a bound frame: replace and clear revoke the previous preview right away,
 * unmount revokes the last one.
 */
function useFrameSlot() {
  const [frame, setFrame] = useState<Frame | undefined>(undefined);
  const frameRef = useRef<Frame | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        URL.revokeObjectURL(frameRef.current.previewUrl);
      }
    };
  }, []);

  function take(file: File) {
    const next: Frame = { file, previewUrl: URL.createObjectURL(file) };
    if (frameRef.current) {
      URL.revokeObjectURL(frameRef.current.previewUrl);
    }
    frameRef.current = next;
    setFrame(next);
  }

  function clear() {
    if (frameRef.current) {
      URL.revokeObjectURL(frameRef.current.previewUrl);
    }
    frameRef.current = undefined;
    setFrame(undefined);
  }

  return { frame, take, clear };
}

/** Cinematic runs ask for five seconds; ModelPicker clamps them to the model's real cap. */
const REQUESTED_DURATION_S = 5;

/** The apertures are plain strings in the look book; the chip group wants id/name rows. */
const APERTURE_OPTIONS: LookOption[] = lookBook.apertures.map((value) => ({
  id: value,
  name: value,
}));

const EMPTY_TITLE = "Build a shot";
const EMPTY_BODY =
  "Stack up to three camera moves, pick a body, lens, aperture, palette and light, then generate. The moves run in the order you set them.";

export function CinematicFlow() {
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const [look, setLook] = useState<LookChoice>(DEFAULT_LOOK);
  const [refs, setRefs] = useState<ReferenceItem[]>([]);
  const [modelId, setModelId] = useState(() => defaultModelForMode("cinematic").id);
  const [prompt, setPrompt] = useState("");
  const [idea, setIdea] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const { job, error, running, submit, reset } = useJob("cinematic");
  const first = useFrameSlot();
  const last = useFrameSlot();

  const model = findModel(modelId) ?? defaultModelForMode("cinematic");
  const durationS = Math.min(REQUESTED_DURATION_S, model.maxDurationS);
  const moves = movesInOrder(moveIds);

  function setLookField(field: keyof LookChoice, id: string) {
    setLook((current) => ({ ...current, [field]: id }));
  }

  function clearFrames() {
    first.clear();
    last.clear();
  }

  async function generate() {
    if (moves.length === 0 || running || uploading) {
      return;
    }

    setUploading(true);
    setUploadError(undefined);
    try {
      const imageName = first.frame ? await uploadAsset(first.frame.file) : undefined;
      const endImageName = last.frame ? await uploadAsset(last.frame.file) : undefined;
      const params: Record<string, string | number | boolean> = {
        moves: moves.map((move) => move.id).join(","),
        body: look.body,
        lens: look.lens,
        aperture: look.aperture,
        palette: look.palette,
        lighting: look.lighting,
        refCount: refs.length,
        firstFrame: imageName !== undefined,
        lastFrame: endImageName !== undefined,
      };
      if (imageName !== undefined) {
        params.imageName = imageName;
      }
      if (endImageName !== undefined) {
        params.endImageName = endImageName;
      }
      submit({
        mode: "cinematic",
        modelId,
        prompt: prompt.trim() || composePrompt(moves, look),
        durationS,
        params,
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
        <span className={flowStyles.kicker}>New shot</span>
        <h1>Cinematic</h1>
        <p className={flowStyles.lead}>
          Search the move library and stack up to three moves in order, then set the look: body,
          lens, aperture, palette and lighting. Add references or bound the shot with a first and a
          last frame.
        </p>
      </header>

      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <Panel title="Moves" subtitle="Up to three, in the order you pick them.">
            <PresetPicker moves={cameraMoves} selected={moveIds} onChange={setMoveIds} />
          </Panel>

          <PromptHelp idea={idea} onIdeaChange={setIdea} moves={moves} look={look} onPrompt={setPrompt} />

          <Panel title="Look" subtitle="Camera body, lens, aperture, palette and lighting.">
            <div className={styles.look}>
              <LookGroup
                label="Body"
                options={lookBook.bodies}
                value={look.body}
                onChange={(id) => setLookField("body", id)}
              />
              <LookGroup
                label="Lens"
                options={lookBook.lenses}
                value={look.lens}
                onChange={(id) => setLookField("lens", id)}
              />
              <LookGroup
                label="Aperture"
                options={APERTURE_OPTIONS}
                value={look.aperture}
                onChange={(id) => setLookField("aperture", id)}
              />
              <LookGroup
                label="Palette"
                options={lookBook.palettes}
                value={look.palette}
                onChange={(id) => setLookField("palette", id)}
              />
              <LookGroup
                label="Lighting"
                options={lookBook.lighting}
                value={look.lighting}
                onChange={(id) => setLookField("lighting", id)}
              />
            </div>
          </Panel>

          <Panel title="References" subtitle="Up to 50 stills to steer the look, each with a weight.">
            <ReferenceTray max={50} items={refs} onChange={setRefs} label="References" />
          </Panel>

          <Panel title="Frames" subtitle="Optional first and last frame for the shot.">
            <div className={styles.frames}>
              <Dropzone
                label="First frame"
                hint="Click or drop an image"
                accept="image/*"
                onFile={first.take}
                fileName={first.frame?.file.name}
                previewUrl={first.frame?.previewUrl}
              />
              <Dropzone
                label="Last frame"
                hint="Click or drop an image"
                accept="image/*"
                onFile={last.take}
                fileName={last.frame?.file.name}
                previewUrl={last.frame?.previewUrl}
              />
            </div>
            {first.frame || last.frame ? (
              <div className={styles.frameActions}>
                <Button variant="ghost" onClick={clearFrames}>
                  Clear frames
                </Button>
              </div>
            ) : null}
          </Panel>

          <Panel title="Model" subtitle="Priced before you generate.">
            <ModelPicker
              mode="cinematic"
              value={modelId}
              durationS={durationS}
              onChange={setModelId}
            />
          </Panel>

          <Panel
            title="Prompt"
            subtitle="Optional. An empty prompt is written from the moves and the look."
          >
            <TextArea
              label="Prompt"
              value={prompt}
              onChange={setPrompt}
              placeholder="wide reveal into a slow push-in on the subject, shot on a 35mm lens, golden hour"
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
            <Button wide onClick={generate} disabled={moves.length === 0} loading={running || uploading}>
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
