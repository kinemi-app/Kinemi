"use client";

import { useState } from "react";
import { Button, Chip, Panel, Segmented, Slider } from "../../ui";
import {
  BACKGROUNDS,
  BUSY_TITLE,
  LIGHTING_MATCH_DEFAULT,
  LIGHTING_MATCH_MAX,
  LIGHTING_MATCH_MIN,
  type FashionRunProps,
} from "./fashionConfig";
import styles from "./fashion.module.css";

export function MatchPanel({ running, active, onRun }: FashionRunProps) {
  const [keepDrape, setKeepDrape] = useState(true);
  const [keepLighting, setKeepLighting] = useState(true);
  const [lightingMatch, setLightingMatch] = useState(LIGHTING_MATCH_DEFAULT);
  const [background, setBackground] = useState("studio");

  function matchLook() {
    const keeps = [keepDrape ? "keep the drape" : "", keepLighting ? "keep the lighting" : ""]
      .filter(Boolean)
      .join(", ");
    onRun({
      feature: "match",
      prompt: `match a ${background} background at lighting ${lightingMatch}/10${keeps ? `, ${keeps}` : ""}`,
      params: { keepDrape, keepLighting, lightingMatch, background },
    });
  }

  return (
    <Panel title="Drape and lighting" subtitle="Set the background and how strongly the light should match.">
      <div className={styles.stack}>
        <div className={styles.chips} role="group" aria-label="Preserve">
          <Chip active={keepDrape} onClick={() => setKeepDrape(!keepDrape)}>Keep drape</Chip>
          <Chip active={keepLighting} onClick={() => setKeepLighting(!keepLighting)}>Keep lighting</Chip>
        </div>
        <Slider label="Lighting match" value={lightingMatch} min={LIGHTING_MATCH_MIN} max={LIGHTING_MATCH_MAX} step={1} unit="/10" onChange={setLightingMatch} />
        <div className={styles.fieldGroup}>
          <span className={styles.controlLabel}>Background</span>
          <Segmented label="Background" value={background} options={BACKGROUNDS} onChange={setBackground} />
        </div>
        <Button wide onClick={matchLook} disabled={running} loading={active} title={running ? BUSY_TITLE : undefined}>
          Match
        </Button>
      </div>
    </Panel>
  );
}
