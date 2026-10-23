"use client";

import { useEffect, useState } from "react";
import { findModel } from "../../../lib/models";
import { Button, Dropzone, Panel, Segmented, Slider, TextArea, useJob } from "../../ui";
import { ResultStage } from "../index";
import flowStyles from "../flow.module.css";
import {
  AMBIENCE,
  AUDIO_MODEL,
  DEFAULT_AMBIENCE,
  DEFAULT_LANGUAGE,
  DEFAULT_LENGTH_S,
  DEFAULT_SPEAKERS,
  DEFAULT_SPEED,
  DEFAULT_VOICE,
  EMPTY_BODY,
  EMPTY_TITLE,
  LANGUAGES,
  MAX_LENGTH_S,
  MAX_SPEED,
  MIN_LENGTH_S,
  MIN_SPEED,
  SPEAKERS,
  VOICES,
  buttonTitle,
  optionLabel,
  parseScene,
  sceneIsValid,
  type AudioFeature,
} from "./audioConfig";
import styles from "./audio.module.css";
import { uploadAsset } from "./upload";
import { useSceneQueue } from "./useSceneQueue";

type Uploads = { audio?: File; video?: File };

export function AudioFlow() {
  const [lengthS, setLengthS] = useState(DEFAULT_LENGTH_S);
  const [activeFeature, setActiveFeature] = useState<AudioFeature | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);

  const [script, setScript] = useState("");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);

  const [cloneSource, setCloneSource] = useState<File | undefined>(undefined);
  const [cloneScript, setCloneScript] = useState("");
  const [cloneConsent, setCloneConsent] = useState(false);

  const [swapSource, setSwapSource] = useState<File | undefined>(undefined);
  const [swapVoiceSample, setSwapVoiceSample] = useState<File | undefined>(undefined);

  const [dubSource, setDubSource] = useState<File | undefined>(undefined);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);

  const [sceneScript, setSceneScript] = useState("");
  const [speakers, setSpeakers] = useState(DEFAULT_SPEAKERS);
  const [ambience, setAmbience] = useState(DEFAULT_AMBIENCE);

  const [sfxPrompt, setSfxPrompt] = useState("");
  const [sfxClip, setSfxClip] = useState<File | undefined>(undefined);

  const { job, error, running, submit } = useJob("audio");
  const scene = useSceneQueue(job, error, submit);

  const audioResult =
    job?.status === "succeeded" && job.result?.kind === "audio" ? job.result : undefined;
  const busy = running || uploading || scene.running;

  const voiceoverReady = script.trim() !== "";
  const cloneReady = cloneSource !== undefined && cloneScript.trim() !== "" && cloneConsent;
  const swapReady = swapSource !== undefined && swapVoiceSample !== undefined;
  const dubReady = dubSource !== undefined;
  const sceneReady = sceneIsValid(sceneScript);
  const sfxReady = sfxPrompt.trim() !== "";

  const cloneMissing =
    cloneSource === undefined
      ? "Add a voice sample first"
      : cloneScript.trim() === ""
        ? "Write the line to speak"
        : "Confirm you have the right to use this voice";
  const swapMissing =
    swapSource === undefined ? "Add a source video first" : "Add a target voice sample first";
  const sceneMissing =
    sceneScript.trim() === ""
      ? "Write a scene script first"
      : "Write each speaker line as Name: line";

  useEffect(() => {
    if (!running && !uploading && !scene.running) {
      setActiveFeature(undefined);
    }
  }, [running, uploading, scene.running]);

  async function run(
    feature: AudioFeature,
    prompt: string,
    params: Record<string, string | number | boolean>,
    files?: Uploads,
  ): Promise<void> {
    if (busy) return;
    scene.reset();
    setActiveFeature(feature);
    setUploadError(undefined);
    setUploading(true);

    const model = findModel(AUDIO_MODEL[feature]);
    const durationS = Math.min(lengthS, model?.maxDurationS ?? lengthS);

    try {
      const uploaded: Record<string, string> = {};
      if (files?.audio) {
        uploaded.audioName = await uploadAsset(files.audio);
      }
      if (files?.video) {
        uploaded.videoName = await uploadAsset(files.video);
      }

      submit({
        mode: "audio",
        modelId: AUDIO_MODEL[feature],
        prompt,
        durationS,
        params: { feature, ...params, ...uploaded },
      });
    } catch (cause) {
      setActiveFeature(undefined);
      setUploadError(cause instanceof Error ? cause.message : "the upload failed");
    } finally {
      setUploading(false);
    }
  }

  function generateVoiceover() {
    if (!voiceoverReady || busy) return;
    void run("voiceover", script.trim(), { voice, speed });
  }

  function cloneVoice() {
    if (!cloneReady || busy || !cloneSource) return;
    void run("clone", cloneScript.trim(), { consent: true }, { audio: cloneSource });
  }

  function swapVoiceInClip() {
    if (!swapReady || busy || !swapSource || !swapVoiceSample) return;
    void run(
      "swap",
      `swap the voice in ${swapSource.name} to the uploaded voice`,
      {},
      { audio: swapVoiceSample, video: swapSource },
    );
  }

  function dubClip() {
    if (!dubReady || busy || !dubSource) return;
    void run(
      "dub",
      `dub ${dubSource.name} into ${optionLabel(LANGUAGES, language)}`,
      { language },
      { video: dubSource },
    );
  }

  function renderScene() {
    if (!sceneReady || busy) return;
    const lines = parseScene(sceneScript);
    if (!lines) return;

    setActiveFeature("scene");
    setUploadError(undefined);
    const model = findModel(AUDIO_MODEL.scene);
    const durationS = Math.min(lengthS, model?.maxDurationS ?? lengthS);

    scene.start(
      lines.map((line) => ({
        mode: "audio" as const,
        modelId: AUDIO_MODEL.scene,
        prompt: line.text,
        durationS,
        params: {
          feature: "scene",
          speaker: line.speaker,
          speakers: Number(speakers),
          ambience,
        },
      })),
    );
  }

  function generateSfx() {
    if (!sfxReady || busy) return;
    void run("sfx", sfxPrompt.trim(), {}, sfxClip ? { audio: sfxClip } : undefined);
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Sound</span>
        <h1>Audio Studio</h1>
        <p className={flowStyles.lead}>
          Six jobs share one page and one result: read a script, copy a voice, swap a voice in a
          video, dub it, render a scene or make a sound effect. Every run returns a demo tone until a
          Comfy deployment is connected.
        </p>
      </header>

      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <Panel
            title="Voiceover / text-to-speech"
            subtitle="Kokoro TTS reads the script. The demo returns a tone."
          >
            <div className={styles.stack}>
              <TextArea
                label="Script"
                hint="One voice reads the whole script."
                value={script}
                onChange={setScript}
                placeholder="The line you want spoken."
                rows={4}
              />
              <Segmented label="Voice" value={voice} options={VOICES} onChange={setVoice} />
              <Slider
                label="Speed"
                value={speed}
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={0.1}
                unit="x"
                onChange={setSpeed}
              />
              <Button
                wide
                onClick={generateVoiceover}
                disabled={!voiceoverReady || busy}
                loading={activeFeature === "voiceover" && (running || uploading)}
                title={buttonTitle(voiceoverReady, "Write a script first", busy)}
              >
                Generate voiceover
              </Button>
            </div>
          </Panel>

          <Panel
            title="Voice cloning"
            subtitle="The sample is uploaded to the Comfy input folder; the run sends its name and your consent."
          >
            <div className={styles.stack}>
              <Dropzone
                label="Drop a voice sample"
                hint="Click or drop a short audio clip"
                accept="audio/*"
                onFile={(file) => {
                  setCloneSource(file);
                  setCloneConsent(false);
                }}
                fileName={cloneSource?.name}
              />
              <TextArea
                label="Line to speak"
                hint="The words the cloned voice says."
                value={cloneScript}
                onChange={setCloneScript}
                placeholder="The line you want the cloned voice to say."
                rows={3}
              />
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={cloneConsent}
                  onChange={(event) => setCloneConsent(event.target.checked)}
                />
                <span>I have the right to use this voice</span>
              </label>
              <Button
                wide
                onClick={cloneVoice}
                disabled={!cloneReady || busy}
                loading={activeFeature === "clone" && (running || uploading)}
                title={buttonTitle(cloneReady, cloneMissing, busy)}
              >
                Clone voice
              </Button>
            </div>
          </Panel>

          <Panel
            title="Voice swap"
            subtitle="Chatterbox. The video is uploaded with the voice that replaces its audio; picture and timing stay."
          >
            <div className={styles.stack}>
              <Dropzone
                label="Drop a source video"
                hint="Click or drop a video"
                accept="video/*"
                onFile={setSwapSource}
                fileName={swapSource?.name}
              />
              <Dropzone
                label="Drop a target voice sample"
                hint="The voice the video should speak in"
                accept="audio/*"
                onFile={setSwapVoiceSample}
                fileName={swapVoiceSample?.name}
              />
              <Button
                wide
                onClick={swapVoiceInClip}
                disabled={!swapReady || busy}
                loading={activeFeature === "swap" && (running || uploading)}
                title={buttonTitle(swapReady, swapMissing, busy)}
              >
                Swap voice
              </Button>
            </div>
          </Panel>

          <Panel
            title="Dubbing and translation"
            subtitle={`Chatterbox. ${LANGUAGES.length} target languages in this build.`}
          >
            <div className={styles.stack}>
              <Dropzone
                label="Drop a source video"
                hint="Click or drop a video"
                accept="video/*"
                onFile={setDubSource}
                fileName={dubSource?.name}
              />
              <label className={styles.selectField}>
                <span className={styles.selectLabel}>Target language</span>
                <select
                  className={styles.select}
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  {LANGUAGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                wide
                onClick={dubClip}
                disabled={!dubReady || busy}
                loading={activeFeature === "dub" && (running || uploading)}
                title={buttonTitle(dubReady, "Add a source video first", busy)}
              >
                Dub
              </Button>
            </div>
          </Panel>

          <Panel
            title="Multi-speaker scene"
            subtitle="Chatterbox. One line per speaker, written as Name: line, rendered in script order."
          >
            <div className={styles.stack}>
              <TextArea
                label="Script"
                hint="One line per speaker, as Name: line."
                value={sceneScript}
                onChange={setSceneScript}
                placeholder={"Mara: The rain has not stopped.\nJon: Then we stay."}
                rows={5}
              />
              <Segmented
                label="Speakers"
                value={speakers}
                options={SPEAKERS}
                onChange={setSpeakers}
              />
              <Segmented
                label="Ambience"
                value={ambience}
                options={AMBIENCE}
                onChange={setAmbience}
              />
              <Button
                wide
                onClick={renderScene}
                disabled={!sceneReady || busy}
                loading={activeFeature === "scene" && (running || uploading)}
                title={buttonTitle(sceneReady, sceneMissing, busy)}
              >
                Render scene
              </Button>
            </div>
          </Panel>

          <Panel
            title="Sound effects"
            subtitle="AudioGen Medium. A reference clip is uploaded and uses the deployment's matcher when present."
          >
            <div className={styles.stack}>
              <TextArea
                label="Sound"
                value={sfxPrompt}
                onChange={setSfxPrompt}
                placeholder="Rain on a metal roof, close, no music."
                rows={3}
              />
              <Dropzone
                label="Drop a reference clip (optional)"
                hint="Click or drop an audio clip; the matcher loads its waveform"
                accept="audio/*"
                onFile={setSfxClip}
                fileName={sfxClip?.name}
              />
              <Button
                wide
                onClick={generateSfx}
                disabled={!sfxReady || busy}
                loading={activeFeature === "sfx" && (running || uploading)}
                title={buttonTitle(sfxReady, "Describe the sound effect first", busy)}
              >
                Generate SFX
              </Button>
            </div>
          </Panel>
        </div>

        <div className={flowStyles.stage}>
          <Panel
            title="Length"
            subtitle="One length for every job on this page; sound effects cap at 10s."
          >
            <Slider
              label="Length"
              value={lengthS}
              min={MIN_LENGTH_S}
              max={MAX_LENGTH_S}
              step={1}
              unit="s"
              onChange={setLengthS}
            />
          </Panel>

          {scene.clips.length > 0 ? (
            <Panel title="Scene clips" subtitle="One clip per speaker line, in script order.">
              <div className={styles.stack}>
                {scene.clips.map((clip, at) => (
                  <div className={styles.clip} key={`${clip.speaker}-${at}`}>
                    <div className={styles.clipHead}>
                      <span className={styles.clipName}>{clip.speaker}</span>
                      <span className={styles.clipStatus}>{clip.status}</span>
                    </div>
                    <p className={styles.clipText}>{clip.text}</p>
                    {clip.url ? (
                      <audio
                        className={styles.audio}
                        controls
                        src={clip.url}
                        aria-label={`${clip.speaker} line`}
                      />
                    ) : null}
                    {clip.error ? <p className={flowStyles.error}>{clip.error}</p> : null}
                  </div>
                ))}
                <p className={styles.note}>
                  Clips stay separate, one per line; this build does not mix them into a single
                  track.
                </p>
                {scene.failure ? <p className={flowStyles.error}>{scene.failure}</p> : null}
              </div>
            </Panel>
          ) : audioResult ? (
            <Panel title="Result">
              <div className={styles.stack}>
                <audio
                  className={styles.audio}
                  controls
                  src={audioResult.url}
                  aria-label="Generated audio"
                />
                {job?.demo ? <p className={styles.note}>Demo tone, not a voice.</p> : null}
              </div>
            </Panel>
          ) : (
            <ResultStage
              job={job}
              error={uploadError ?? error}
              running={running || uploading}
              emptyTitle={EMPTY_TITLE}
              emptyBody={EMPTY_BODY}
            />
          )}
        </div>
      </div>
    </main>
  );
}
