"use client";

import { useId } from "react";
import { Chip, Field, Panel } from "../../ui";
import { ReferenceTray } from "../ReferenceTray";
import type { ReferenceItem } from "../ReferenceTray";
import { EmotionWheel } from "./EmotionWheel";
import styles from "./genjutsu.module.css";

export type CharacterCardProps = {
  name: string;
  onName: (name: string) => void;
  refs: ReferenceItem[];
  onRefs: (items: ReferenceItem[]) => void;
  emotions: string[];
  onEmotions: (emotions: string[]) => void;
  maxRefs: number;
};

export const DEFAULT_CHARACTER_NAME = "Hero";

/** Name, identity references and the emotion lines the character carries into the prompt. */
export function CharacterCard({
  name,
  onName,
  refs,
  onRefs,
  emotions,
  onEmotions,
  maxRefs,
}: CharacterCardProps) {
  const nameId = useId();
  const character = name.trim() || DEFAULT_CHARACTER_NAME;

  function removeEmotion(emotion: string) {
    onEmotions(emotions.filter((item) => item !== emotion));
  }

  return (
    <Panel title="Character card" subtitle="Who takes the performance">
      <div className={styles.stack}>
        <Field label="Name" htmlFor={nameId}>
          <input
            id={nameId}
            className={styles.nameInput}
            value={name}
            placeholder={DEFAULT_CHARACTER_NAME}
            onChange={(event) => onName(event.target.value)}
          />
        </Field>

        <ReferenceTray
          max={maxRefs}
          label="Identity references"
          hint={`Up to ${maxRefs} images of the same face or character.`}
          items={refs}
          onChange={onRefs}
        />

        <EmotionWheel value={emotions} onChange={onEmotions} />

        {emotions.length > 0 ? (
          <ul className={styles.tags} aria-label="Emotion tags">
            {emotions.map((emotion) => (
              <li key={emotion}>
                <Chip
                  active
                  onClick={() => removeEmotion(emotion)}
                  title={`Remove ${emotion}`}
                >
                  @{character} {emotion}
                </Chip>
              </li>
            ))}
          </ul>
        ) : null}

        <p className={styles.identityStatus}>
          Identity training: demo. A COMFY_URL is required to train.
        </p>
      </div>
    </Panel>
  );
}
