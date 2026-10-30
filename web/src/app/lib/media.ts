// A server render's file: what extension it downloads under.

const MEDIA_EXTENSION = { image: 'png', video: 'mp4', audio: 'wav' } as const;

/**
 * The extension a server render saves under: a data: URL's own type (demo), the `filename` of a
 * ComfyUI /view link, the path's extension, else one for its media kind.
 */
export function serverExtension(url: string, media: keyof typeof MEDIA_EXTENSION | undefined, base: string): string {
  const dataType = /^data:[a-z]+\/([a-z0-9]+)/i.exec(url)?.[1];
  if (dataType) return dataType;
  const parsed = new URL(url, base);
  const name = parsed.searchParams.get('filename') ?? parsed.pathname;
  return /\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? MEDIA_EXTENSION[media ?? 'image'];
}
