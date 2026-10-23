"use client";

import { useState } from "react";
import { Button, Panel, Slider, TextArea } from "../../ui";
import type { GenerateRequest } from "../../../lib/types";
import { STILL_DURATION_S } from "./adsConfig";
import {
  DEFAULT_VARIANTS,
  MAX_HOOK_IDEA,
  MAX_VARIANTS,
  MIN_VARIANTS,
  hookLines,
  normalizeIdea,
} from "./hookVariants";
import { useBatchJobs, type BatchItem } from "./useBatchJobs";
import flowStyles from "../flow.module.css";
import styles from "./ads.module.css";

type Props = { modelId: string };

const EXPORT_FILE = "hook-variations.txt";

function statusText(item: BatchItem): string {
  switch (item.status) {
    case "queued":
      return "Queued";
    case "running":
      return `Rendering ${item.progress}%`;
    case "succeeded":
      return "Done";
    default:
      return "Failed";
  }
}

export function HooksPanel({ modelId }: Props) {
  const [idea, setIdea] = useState("");
  const [variants, setVariants] = useState(DEFAULT_VARIANTS);
  const [submitted, setSubmitted] = useState<string[] | undefined>(undefined);
  const { items, running, run } = useBatchJobs();
  const cleanIdea = normalizeIdea(idea);
  const ideaTooLong = idea.trim().length > MAX_HOOK_IDEA;
  const canGenerate = cleanIdea !== "" && !ideaTooLong;
  const lines = canGenerate ? hookLines(cleanIdea, variants) : [];
  const failed = items.filter((item) => item.status === "failed").length;
  const done = items.filter((item) => item.status === "succeeded").length;
  /** Statuses line up with the visible list only while the list is the one that was submitted. */
  const shown = submitted !== undefined && submitted.join("\n") === lines.join("\n") ? items : [];
  let disabledTitle: string | undefined;
  if (cleanIdea === "") disabledTitle = "Type a hook idea first";
  else if (ideaTooLong) disabledTitle = `Keep the idea to ${MAX_HOOK_IDEA} characters or fewer`;
  else if (running) disabledTitle = "The variants are rendering";

  function generate() {
    if (!canGenerate || running) {
      return;
    }
    const requests: GenerateRequest[] = lines.map((line, index) => ({
      mode: "ads",
      modelId,
      prompt: `hook variation ${index + 1}/${lines.length}: ${line}`,
      durationS: STILL_DURATION_S,
      seed: index + 1,
      params: { feature: "hooks", variantIndex: index, variantCount: lines.length },
    }));
    setSubmitted(lines);
    run(requests);
  }

  function exportList() {
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = EXPORT_FILE;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Panel title="Hook variations" subtitle={`One idea becomes ${MIN_VARIANTS} to ${MAX_VARIANTS} short lines, written here in the browser.`}>
      <div className={styles.stack}>
        <TextArea label="Hook idea" hint="One sentence. The list is built from it on this page." value={idea} onChange={setIdea} placeholder="a desk lamp that charges your phone" rows={3} />
        <div className={styles.countRow}>
          <span className={styles.controlLabel}>Idea length</span>
          <span className={ideaTooLong ? flowStyles.error : styles.count}>{idea.trim().length} / {MAX_HOOK_IDEA}</span>
        </div>
        <Slider label="Variants" value={variants} min={MIN_VARIANTS} max={MAX_VARIANTS} step={1} onChange={setVariants} />
        {lines.length > 0 ? (
          <ol className={styles.hookList} aria-label="Hook variants">
            {lines.map((line, index) => {
              const item = shown[index];
              return (
                <li key={line} className={styles.hook}>
                  <span className={styles.hookIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.hookLine}>{line}</span>
                  {item ? (
                    <span className={item.status === "failed" ? flowStyles.error : styles.hookStatus}>
                      {statusText(item)}
                    </span>
                  ) : null}
                  {item?.status === "failed" ? <span className={flowStyles.error}>{item.error}</span> : null}
                  {item?.status === "succeeded" && item.result ? (
                    <a className={styles.hookLink} href={item.result.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.note}>{ideaTooLong ? "Shorten the idea to see the lines." : "The lines appear here as you type."}</p>
        )}
        {submitted !== undefined ? (
          <p className={styles.note}>
            Last run: {done} of {submitted.length} rendered
            {failed > 0 ? `, ${failed} failed` : ""}.
          </p>
        ) : null}
        <div className={styles.buttonRow}>
          <Button onClick={generate} disabled={!canGenerate || running} loading={running} title={disabledTitle}>
            Generate variants
          </Button>
          <Button variant="ghost" onClick={exportList} disabled={lines.length === 0}>
            Export list
          </Button>
        </div>
      </div>
    </Panel>
  );
}
