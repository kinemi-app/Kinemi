"use client";

import { useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { cx } from "./controls";
import styles from "./ui.module.css";

export type PanelProps = {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, subtitle, right, children }: PanelProps) {
  const showHead = Boolean(title) || Boolean(right);

  return (
    <section className={styles.panel}>
      {showHead ? (
        <header className={styles.panelHead}>
          <div className={styles.panelHeadMain}>
            {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
            {subtitle ? <p className={styles.panelSub}>{subtitle}</p> : null}
          </div>
          {right ? <div className={styles.panelRight}>{right}</div> : null}
        </header>
      ) : null}
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function Progress({ value, label = "Rendering" }: { value: number; label?: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {body ? <p className={styles.emptyBody}>{body}</p> : null}
      {action}
    </div>
  );
}

export type DropzoneProps = {
  label: string;
  hint?: string;
  accept?: string;
  onFile: (file: File) => void;
  fileName?: string;
  previewUrl?: string;
};

export function Dropzone({ label, hint, accept, onFile, fileName, previewUrl }: DropzoneProps) {
  const [over, setOver] = useState(false);

  function take(file: File | undefined) {
    if (file) {
      onFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer.files[0]);
  }

  const caption = previewUrl ? "Replace file" : label;

  return (
    <label
      className={cx(styles.dropzone, over && styles.dropzoneOver)}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <input
        className={styles.dropInput}
        type="file"
        accept={accept}
        aria-label={label}
        onChange={(event) => {
          take(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {previewUrl ? (
        <img className={styles.dropPreview} src={previewUrl} alt={fileName ?? label} />
      ) : null}
      <span className={styles.dropLabel}>{caption}</span>
      {fileName ? <span className={styles.dropFile}>{fileName}</span> : null}
      {hint && !fileName ? <span className={styles.dropHint}>{hint}</span> : null}
    </label>
  );
}
