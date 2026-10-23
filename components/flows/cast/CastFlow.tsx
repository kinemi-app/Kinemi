"use client";
import { useEffect, useId, useRef, useState } from "react";
import { loadCast, newCharacter, saveCast, type CastCharacter, type CastRef } from "../../../lib/cast";
import { Button, Chip, Dropzone, Field, Panel } from "../../ui";
import { uploadAsset, uploadErrorText } from "../uploadAsset";
import { loadCastAssets, saveCastAssets, type CastAssets } from "./castAssets";
import flowStyles from "../flow.module.css";
import styles from "./cast.module.css";
const COPIED_MS = 1500; const MAX_REFS = 3; const MAX_BYTES = 2 * 1024 * 1024;
const PROBE = "kinemi.cast.probe";
const SAVE_FAILED = "Could not save: browser storage is full or blocked. Delete a character and try again.";
const ASSET_SAVE_FAILED = "The uploaded reference names could not be stored: browser storage is full or blocked.";
const STORAGE_BLOCKED = "Local storage is unavailable in this browser. Characters will not survive a reload.";
const EMOTIONS = ["joy", "anger", "fear", "sadness", "surprise", "disgust", "desire", "calm"];
type CopyState = "idle" | "copied" | "failed";
type Draft = { id?: string; name: string; refs: CastRef[]; emotion?: string };

/** Shrink a reference to a 512 px JPEG data URL, so three of them fit in localStorage. */
async function toStoredDataUrl(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("unreadable")));
    reader.onerror = () => reject(new Error("unreadable"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("unreadable"));
    element.src = source;
  });
  const scale = Math.min(1, 512 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** The stored reference is a data URL; POST /api/assets takes a file, so rebuild one from it. */
async function uploadFile(ref: CastRef): Promise<File> {
  const response = await fetch(ref.dataUrl);
  if (!response.ok) throw new Error("the stored image could not be read");
  const blob = await response.blob();
  return new File([blob], ref.name, { type: blob.type || "image/jpeg" });
}

export function CastFlow() {
  const [cast, setCast] = useState<CastCharacter[]>([]);
  const [assets, setAssets] = useState<CastAssets>({});
  const [draft, setDraft] = useState<Draft>({ name: "", refs: [] });
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const [saved, setSaved] = useState(false);
  const draftRef = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nameId = useId();
  draftRef.current = draft;
  const selected = cast.find((character) => character.id === draft.id);
  const storedRefs = draft.id ? (assets[draft.id]?.refs ?? {}) : {};
  const tag = selected && draft.emotion ? `@${selected.name} ${draft.emotion}` : "";
  const copyLabel = copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : "Copy tag";
  useEffect(() => {
    try { localStorage.setItem(PROBE, "1"); localStorage.removeItem(PROBE); } catch { setBlocked(true); }
    setCast(loadCast());
    setAssets(loadCastAssets());
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);
  function open(character?: CastCharacter) {
    setDraft(character ? { id: character.id, name: character.name, refs: character.refs, emotion: character.emotions[0] } : { name: "", refs: [] });
    setError(""); setSaved(false); setCopy("idle");
  }
  async function addReference(file: File) {
    if (saving) return;
    setError(""); setSaved(false);
    if (!file.type.startsWith("image/")) return setError(`${file.name} is not an image file.`);
    if (file.size > MAX_BYTES) return setError(`${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Each reference can be at most 2 MB.`);
    if (draftRef.current.refs.length >= MAX_REFS) return setError(`A character holds at most ${MAX_REFS} reference images.`);
    try {
      const dataUrl = await toStoredDataUrl(file);
      if (draftRef.current.refs.length >= MAX_REFS) return setError(`A character holds at most ${MAX_REFS} reference images.`);
      setDraft({ ...draftRef.current, refs: [...draftRef.current.refs, { id: `${Date.now()}-${file.name}`, name: file.name, dataUrl }] });
    } catch {
      setError(`${file.name} could not be read. Try another image.`);
    }
  }
  function removeRef(id: string) {
    if (saving) return;
    setDraft({ ...draftRef.current, refs: draftRef.current.refs.filter((ref) => ref.id !== id) });
    setSaved(false);
  }
  function pickEmotion(item: string) {
    setDraft({ ...draftRef.current, emotion: draftRef.current.emotion === item ? undefined : item });
    setSaved(false); setCopy("idle");
  }
  async function save() {
    if (saving) return;
    const cleanName = draft.name.trim();
    if (cleanName === "") return setError("Give the character a name before saving.");
    if (draft.refs.length === 0) return setError("Add at least one reference image before saving.");
    const emotions = draft.emotion ? [draft.emotion] : [];
    const character = selected ? { ...selected, name: cleanName, refs: draft.refs, emotions } : newCharacter(cleanName, draft.refs, emotions);
    const next = selected ? cast.map((entry) => (entry.id === selected.id ? character : entry)) : [character, ...cast];

    setError(""); setSaving(true);
    try {
      const previous = assets[character.id]?.refs ?? {};
      const names: Record<string, string> = {};
      for (const ref of character.refs) {
        const uploadedName = previous[ref.id];
        if (uploadedName !== undefined) {
          names[ref.id] = uploadedName;
          continue;
        }
        try {
          names[ref.id] = await uploadAsset(await uploadFile(ref));
        } catch (cause) {
          throw new Error(`${ref.name}: ${uploadErrorText(cause)}`);
        }
      }
      if (!saveCast(next)) return setError(SAVE_FAILED);
      const nextAssets = { ...assets, [character.id]: { name: character.name, refs: names } };
      if (!saveCastAssets(nextAssets)) return setError(ASSET_SAVE_FAILED);
      setCast(next);
      setAssets(nextAssets);
      setDraft({ id: character.id, name: character.name, refs: character.refs, emotion: character.emotions[0] });
      setSaved(true);
    } catch (cause) {
      setError(`The references did not upload. ${uploadErrorText(cause)}`);
    } finally {
      setSaving(false);
    }
  }
  function deleteSelected() {
    if (!selected || saving || !window.confirm(`Delete ${selected.name}? This cannot be undone.`)) return;
    const next = cast.filter((character) => character.id !== selected.id);
    if (!saveCast(next)) return setError(SAVE_FAILED);
    const nextAssets = { ...assets };
    delete nextAssets[selected.id];
    const storedNames = saveCastAssets(nextAssets);
    setCast(next);
    setAssets(storedNames ? nextAssets : assets);
    open();
    if (!storedNames) setError(ASSET_SAVE_FAILED);
  }
  async function copyTag() {
    if (!tag) return;
    try {
      await navigator.clipboard.writeText(tag);
    } catch {
      setCopy("failed");
      return;
    }
    setCopy("copied");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), COPIED_MS);
  }
  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}><span className={flowStyles.kicker}>Characters</span><h1>AI Cast</h1><p className={flowStyles.lead}>Save a character with reference images and an emotion, then copy its tag into any prompt.</p></header>
      {blocked ? <p className={flowStyles.error} role="alert">{STORAGE_BLOCKED}</p> : null}
      <div className={flowStyles.grid}>
        <div className={flowStyles.controls}>
          <Panel title={draft.id ? "Edit character" : "New character"} subtitle="Name it, add at least one reference image, then save. Saving uploads the references.">
            <div className={styles.stack}>
              <Field label="Name" htmlFor={nameId}><input id={nameId} className={styles.input} value={draft.name} placeholder="Mara" onChange={(event) => { setDraft({ ...draftRef.current, name: event.target.value }); setSaved(false); setError(""); }} /></Field>
              <div className={styles.refs}>
                <div className={styles.refHead}><span className={styles.refLabel}>Reference images</span><span className={styles.refCount}>{draft.refs.length} / {MAX_REFS}</span></div>
                {draft.refs.length > 0 ? <ul className={styles.refGrid} aria-label="Reference images">{draft.refs.map((ref) => { const uploadedName = storedRefs[ref.id] ?? (saving ? "Uploading…" : "Uploads on save"); return <li key={ref.id} className={styles.ref}><img className={styles.refImage} src={ref.dataUrl} alt={ref.name} /><button type="button" className={styles.refRemove} onClick={() => removeRef(ref.id)} disabled={saving} aria-label={`Remove ${ref.name}`}>×</button><span className={styles.refAsset} title={uploadedName}>{uploadedName}</span></li>; })}</ul> : null}
                {draft.refs.length < MAX_REFS ? <Dropzone label="Add a reference image" hint="Up to 2 MB each, 3 per character." accept="image/*" onFile={addReference} /> : <p className={styles.hint}>{MAX_REFS} of {MAX_REFS} references. Remove one to add another.</p>}
                {error ? <p className={flowStyles.error} role="alert">{error}</p> : null}
              </div>
              <div className={styles.emotionBlock}><span className={styles.refLabel}>Emotion</span><div className={styles.emotions} role="group" aria-label="Emotion">{EMOTIONS.map((item) => <Chip key={item} active={draft.emotion === item} onClick={() => pickEmotion(item)}>{item}</Chip>)}</div><p className={styles.hint}>One emotion per tag. Copy uses the saved name.</p></div>
              {saved ? <p className={styles.saved} role="status">Saved.</p> : null}
              <div className={styles.editorActions}><Button onClick={save} loading={saving} disabled={!draft.name.trim() || draft.refs.length === 0}>{draft.id ? "Save changes" : "Save character"}</Button>{draft.id ? <Button variant="ghost" onClick={deleteSelected} disabled={saving}>Delete</Button> : null}</div>
            </div>
          </Panel>
        </div>
        <div className={flowStyles.stage}>
          <Panel title="Saved cast" subtitle={`${cast.length} ${cast.length === 1 ? "character" : "characters"} in this browser.`} right={cast.length > 0 ? <Button variant="quiet" onClick={() => open()}>New character</Button> : undefined}>
            {cast.length === 0 ? <div className={styles.empty}><p className={styles.emptyTitle}>No saved cast yet</p><p>Name a character, add a reference image, then press Save.</p></div> : <ul className={styles.cards} aria-label="Saved characters">{cast.map((character) => { const cover = character.refs[0]; const active = character.id === draft.id; return <li key={character.id}><button type="button" aria-pressed={active} onClick={() => open(character)} className={active ? `${styles.card} ${styles.cardOn}` : styles.card}>{cover ? <img className={styles.cardImage} src={cover.dataUrl} alt={`${character.name} reference`} /> : null}<span className={styles.cardBody}><span className={styles.cardName}>{character.name}</span><span className={styles.cardMeta}>{character.refs.length} {character.refs.length === 1 ? "reference" : "references"} · {character.emotions[0] ?? "no emotion"}</span></span></button></li>; })}</ul>}
          </Panel>
          <Panel title="Prompt tag" subtitle="Paste it into any prompt to call this character with the selected emotion.">
            <div className={styles.tagBlock}><p className={styles.tag} aria-live="polite">{tag || "Select a saved character and an emotion."}</p><div className={flowStyles.actions}><Button wide onClick={copyTag} disabled={!tag}>{copyLabel}</Button></div>{copy === "failed" ? <p className={flowStyles.error} role="alert">Could not write to the clipboard. Copy the tag by hand.</p> : null}</div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
