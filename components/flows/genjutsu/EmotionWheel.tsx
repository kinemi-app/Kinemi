"use client";

import { cx } from "../../ui";
import styles from "./genjutsu.module.css";

export type EmotionWheelProps = {
  value: string[];
  onChange: (value: string[]) => void;
};

/** The eight emotions, clockwise from the top. */
const EMOTIONS = ["joy", "anger", "fear", "sadness", "surprise", "disgust", "desire", "calm"];

/** A circular multi-select: toggle any of the eight emotions; each becomes an @name tag. */
export function EmotionWheel({ value, onChange }: EmotionWheelProps) {
  function toggle(emotion: string) {
    if (value.includes(emotion)) {
      onChange(value.filter((item) => item !== emotion));
      return;
    }
    onChange([...value, emotion]);
  }

  return (
    <div className={styles.wheelArea}>
      <div className={styles.wheel} role="group" aria-label="Emotions">
        {EMOTIONS.map((emotion) => {
          const selected = value.includes(emotion);
          return (
            <button
              key={emotion}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(emotion)}
              className={cx(styles.emotion, selected && styles.emotionOn)}
            >
              {emotion}
            </button>
          );
        })}
        <p className={styles.wheelCount} aria-live="polite">
          {value.length} selected
        </p>
      </div>
      <p className={styles.wheelHint}>Each selected emotion is applied as an @name tag in the prompt.</p>
    </div>
  );
}
