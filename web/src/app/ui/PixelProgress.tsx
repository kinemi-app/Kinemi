// A progress bar made of pixel blocks that fill one at a time.
export function PixelProgress({ value, blocks = 24 }: { value: number; blocks?: number }) {
  const on = Math.round(value * blocks);
  return (
    <span class="pxbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      {Array.from({ length: blocks }, (_, i) => (
        <i key={i} class={i < on ? 'on' : i === on ? 'next' : undefined} />
      ))}
    </span>
  );
}
