"use client";

import type { CanvasTemplate } from "./templates";
import { Button, cx } from "../../ui";
import styles from "./canvas.module.css";

export type TemplateMessage = { kind: "ok" | "error"; text: string };

type TemplatePanelProps = {
  templates: CanvasTemplate[];
  selectedId: string;
  message: TemplateMessage | undefined;
  onSelect: (id: string) => void;
  onApply: () => void;
  onDownload: () => void;
  onImport: (file: File) => void;
};

function TemplateMessageLine({ message }: { message: TemplateMessage | undefined }) {
  if (!message) return null;
  return (
    <p className={cx(styles.note, message.kind === "error" && styles.noteError)}>{message.text}</p>
  );
}

/** N2: the shipped graph templates, plus import and export of the same JSON shape. */
export function TemplatePanel({
  templates,
  selectedId,
  message,
  onSelect,
  onApply,
  onDownload,
  onImport,
}: TemplatePanelProps) {
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0];

  return (
    <div className={styles.stack}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Template</span>
        <select
          className={styles.select}
          value={selected?.id ?? ""}
          aria-label="Template"
          onChange={(event) => onSelect(event.target.value)}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
      {selected ? <p className={styles.note}>{selected.description}</p> : null}
      <div className={styles.row}>
        <Button onClick={onApply} disabled={!selected}>
          Use template
        </Button>
        <Button variant="ghost" onClick={onDownload}>
          Download board as template
        </Button>
      </div>
      <label className={styles.fileField}>
        <span>Import template JSON</span>
        <input
          className={styles.fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Import template JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.target.value = "";
          }}
        />
      </label>
      <TemplateMessageLine message={message} />
      <p className={styles.note}>
        The JSON is the same shape as the shipped file, so a board you download can be imported
        here or handed to another canvas.
      </p>
    </div>
  );
}
