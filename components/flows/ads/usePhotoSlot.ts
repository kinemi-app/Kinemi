"use client";

import { useEffect, useRef, useState } from "react";
import { uploadAsset, uploadErrorText } from "../uploadAsset";

/** One image the user added, with the object URL its preview reads. */
export type UploadedImage = { file: File; url: string };

export type PhotoSlot = {
  photo?: UploadedImage;
  /** What was wrong with the file itself, shown under the dropzone. */
  error?: string;
  /** True while the photo is being uploaded. */
  busy: boolean;
  take(file: File): void;
  /** The asset name for the current photo, uploaded once; undefined when there is no photo. */
  resolveName(): Promise<string | undefined>;
};

/**
 * One optional photo slot: a preview the panel shows, and the upload that turns the file into the
 * name a graph reads. Changing the photo throws the previous upload away, so a submit never sends
 * the name of a file the user replaced.
 */
export function usePhotoSlot(): PhotoSlot {
  const [photo, setPhoto] = useState<UploadedImage | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const current = useRef<UploadedImage | undefined>(undefined);
  const uploaded = useRef<{ file: File; name: Promise<string> } | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (current.current) URL.revokeObjectURL(current.current.url);
    };
  }, []);

  function take(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(`${file.name} is not an image file.`);
      return;
    }
    if (current.current) URL.revokeObjectURL(current.current.url);
    const next = { file, url: URL.createObjectURL(file) };
    current.current = next;
    uploaded.current = undefined;
    setPhoto(next);
    setError(undefined);
  }

  async function resolveName(): Promise<string | undefined> {
    const picked = current.current;
    if (!picked) {
      return undefined;
    }
    if (uploaded.current?.file !== picked.file) {
      uploaded.current = { file: picked.file, name: uploadAsset(picked.file) };
    }
    const pending = uploaded.current.name;
    setBusy(true);
    try {
      return await pending;
    } catch (cause) {
      // A failed upload is not cached: the next submit tries again.
      if (uploaded.current?.name === pending) {
        uploaded.current = undefined;
      }
      throw new Error(uploadErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return { photo, error, busy, take, resolveName };
}
