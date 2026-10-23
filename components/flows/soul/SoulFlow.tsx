"use client";

import { useEffect, useRef, useState } from "react";
import soulData from "../../../data/presets/soul.json";
import { defaultModelForMode } from "../../../lib/models";
import { Button, Dropzone, Panel, TextArea, cx, useJob } from "../../ui";
import { ModelPicker, ResultStage } from "../index";
import { uploadAsset, uploadErrorText } from "../uploadAsset";
import flowStyles from "../flow.module.css";
import styles from "./soul.module.css";

type SoulPreset = { id: string; name: string; hint?: string; prompt: string };

const PRESETS_FILE = "data/presets/soul.json";
const PALETTE_TOKEN = "{palette}";
const PALETTE_SIZE = 5;
const HUE_STEP = 360 / PALETTE_SIZE;
const SATURATION_MIN = 58;
const SATURATION_SPAN = 16;
const LIGHTNESS_MIN = 40;
const LIGHTNESS_SPAN = 18;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const SOUL_DURATION_S = 1;
const COPIED_MS = 1500;
const INITIAL_SENTENCE = "a lone figure on a rain-soaked street at midnight";
const EMPTY_TITLE = "A sentence is all it takes";
const EMPTY_BODY =
  "Type a sentence to lock five colours, pick a Soul 2.0 preset, then generate. Without COMFY_URL the run returns a demo still.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, key: string, where: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function readPresets(raw: unknown): SoulPreset[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${PRESETS_FILE}: expected a non-empty array of presets`);
  }

  const seen = new Set<string>();
  const presets: SoulPreset[] = [];

  raw.forEach((row, index) => {
    const where = `${PRESETS_FILE}[${index}]`;
    if (!isRecord(row)) {
      throw new Error(`${where}: expected an object`);
    }
    const preset: SoulPreset = {
      id: requireString(row, "id", where),
      name: requireString(row, "name", where),
      prompt: requireString(row, "prompt", where),
    };
    if (!preset.prompt.includes(PALETTE_TOKEN)) {
      throw new Error(`${where}: "prompt" must contain ${PALETTE_TOKEN}`);
    }
    if (typeof row.hint === "string" && row.hint.trim() !== "") {
      preset.hint = row.hint;
    }
    if (seen.has(preset.id)) {
      throw new Error(`${where}: duplicate id "${preset.id}"`);
    }
    seen.add(preset.id);
    presets.push(preset);
  });

  return presets;
}

/** Every Soul preset, validated once at module load. A bad preset file fails the build, not the UI. */
const PRESETS: SoulPreset[] = readPresets(soulData);

/** FNV-1a over UTF-16 code units, the same hash the demo poster uses. */
function fnv1a(text: string): number {
  let value = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, FNV_PRIME);
  }
  return value >>> 0;
}

function hexChannel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = hue / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const offset = l - chroma / 2;
  // Six 60° sectors: the rising channel, the falling one, then the constant one.
  const red =
    sector < 1 ? chroma : sector < 2 ? secondary : sector < 4 ? 0 : sector < 5 ? secondary : chroma;
  const green = sector < 1 ? secondary : sector < 3 ? chroma : sector < 4 ? secondary : 0;
  const blue = sector < 2 ? 0 : sector < 3 ? secondary : sector < 5 ? chroma : secondary;
  return `#${hexChannel((red + offset) * 255)}${hexChannel((green + offset) * 255)}${hexChannel(
    (blue + offset) * 255,
  )}`.toUpperCase();
}

/**
 * Five hues 72° apart from one hash, each with saturation and lightness inside fixed ranges.
 * Trimming means " the street " and "the street" produce the same palette.
 */
function paletteFor(sentence: string): string[] {
  const seed = fnv1a(sentence.trim());
  return Array.from({ length: PALETTE_SIZE }, (_, index) => {
    const hue = (seed + index * HUE_STEP) % 360;
    const saturation = SATURATION_MIN + ((seed >>> (index * 2)) % SATURATION_SPAN);
    const lightness = LIGHTNESS_MIN + ((seed >>> (index * 3)) % LIGHTNESS_SPAN);
    return hslToHex(hue, saturation, lightness);
  });
}

/** A preset prompt is a template: every {palette} token becomes the five codes. */
function composePrompt(template: string, hexes: string[]): string {
  return template.replaceAll(PALETTE_TOKEN, hexes.join(", "));
}

const INITIAL_PALETTE = paletteFor(INITIAL_SENTENCE);

export function SoulFlow() {
  const [sentence, setSentence] = useState(INITIAL_SENTENCE);
  const [palette, setPalette] = useState<string[]>(INITIAL_PALETTE);
  const [presetId, setPresetId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(() => defaultModelForMode("soul").id);
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const [copyFailed, setCopyFailed] = useState(false);
  const [source, setSource] = useState<File | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const { job, error, running, submit } = useJob("soul");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const preset = PRESETS.find((entry) => entry.id === presetId);
  const hasSentence = sentence.trim() !== "";
  const hasPrompt = prompt.trim() !== "";
  const canGenerate = hasSentence && preset !== undefined && hasPrompt;
  const blockedReason = !hasSentence
    ? "Add a sentence to build a palette"
    : !preset
      ? "Pick a Soul 2.0 preset"
      : !hasPrompt
        ? "Write a prompt"
        : undefined;

  useEffect(() => {
    return () => {
      if (copyTimer.current !== undefined) {
        clearTimeout(copyTimer.current);
      }
    };
  }, []);

  function changeSentence(next: string) {
    setSentence(next);
    if (next.trim() !== "") {
      setPalette(paletteFor(next));
    }
  }

  function choosePreset(next: SoulPreset) {
    setPresetId(next.id);
    setPrompt(next.prompt);
  }

  async function copyHex(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      setCopyFailed(false);
      setCopied(hex);
      if (copyTimer.current !== undefined) {
        clearTimeout(copyTimer.current);
      }
      copyTimer.current = setTimeout(() => setCopied(undefined), COPIED_MS);
    } catch {
      setCopied(undefined);
      setCopyFailed(true);
    }
  }

  async function generate() {
    if (!canGenerate || !preset || running || uploading) {
      return;
    }
    setUploadError(undefined);
    let imageName: string | undefined;
    if (source) {
      setUploading(true);
      try {
        imageName = await uploadAsset(source);
      } catch (cause) {
        setUploadError(uploadErrorText(cause));
        return;
      } finally {
        setUploading(false);
      }
    }
    submit({
      mode: "soul",
      modelId,
      prompt: composePrompt(prompt, palette),
      durationS: SOUL_DURATION_S,
      params: {
        palette: palette.join(","),
        preset: preset.id,
        ...(imageName !== undefined ? { imageName } : {}),
      },
    });
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Palette · stills</span>
        <h1>Soul</h1>
        <p className={flowStyles.lead}>
          One sentence becomes five locked colours. Pick a Soul 2.0 preset, then render a still that
          carries the palette into every frame.
        </p>
      </header>

      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <Panel title="Sentence" subtitle="The words set the palette; edit them any time before a run.">
            <TextArea
              label="Sentence"
              hint="Clear it and the last palette stays."
              value={sentence}
              onChange={changeSentence}
              rows={2}
              placeholder="a lone figure on a rain-soaked street at midnight"
            />
          </Panel>

          <Panel title="Palette" subtitle="Five HEX codes, 72° apart. Click one to copy it.">
            <div className={styles.palette} role="group" aria-label="Palette">
              {palette.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={styles.swatch}
                  onClick={() => void copyHex(hex)}
                  aria-label={`Copy ${hex}`}
                >
                  <span className={styles.swatchColor} style={{ background: hex }} />
                  <span className={styles.swatchLabel}>{copied === hex ? "Copied" : hex}</span>
                </button>
              ))}
            </div>
            {copyFailed ? (
              <p className={flowStyles.error}>Could not copy. Select the code and copy it by hand.</p>
            ) : null}
          </Panel>

          <Panel title="Soul 2.0 presets" subtitle="Twelve looks. A preset writes its prompt below.">
            <div className={styles.presets}>
              {PRESETS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={entry.id === presetId}
                  onClick={() => choosePreset(entry)}
                  className={cx(styles.preset, entry.id === presetId && styles.presetOn)}
                >
                  <span className={styles.presetName}>{entry.name}</span>
                  {entry.hint ? <span className={styles.presetHint}>{entry.hint}</span> : null}
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            title="Prompt"
            subtitle={"The {palette} token becomes the five HEX codes when you generate."}
          >
            <TextArea
              label="Prompt"
              hint={"Edit the preset freely; {palette} is replaced at submit."}
              value={prompt}
              onChange={setPrompt}
              rows={6}
              placeholder="Pick a preset to start; edit its prompt as you like."
            />
          </Panel>

          <Panel title="Source photo" subtitle="Optional. Restyle this still with the palette.">
            <Dropzone
              label="Drop a source photo"
              hint="Optional: a still to keep while the palette changes"
              accept="image/*"
              onFile={(file) => {
                setSource(file);
                setUploadError(undefined);
              }}
              fileName={source?.name}
            />
          </Panel>

          <Panel title="Model" subtitle="Soul stills render in one second.">
            <ModelPicker
              mode="soul"
              value={modelId}
              durationS={SOUL_DURATION_S}
              onChange={setModelId}
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
            <Button
              wide
              onClick={generate}
              disabled={!canGenerate}
              loading={running || uploading}
              title={blockedReason}
            >
              Generate
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
