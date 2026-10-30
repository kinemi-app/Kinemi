// Text in the Kinemi pixel alphabet, as inline SVG (the same alphabet as the landing page).
import { layout, toPath } from '../../lib/pixel-font';
import { hash } from '../lib/util';

interface Props {
  text: string;
  /** gradient stops, top to bottom */
  stops?: string[];
  class?: string;
  label?: string;
  decorative?: boolean;
}

export function PixelText({ text, stops = ['#e9fff2', '#39d879'], class: cls, label, decorative }: Props) {
  const { cells, width, height } = layout(text);
  const id = `pt${hash(text + stops.join()).toString(36)}`;
  return (
    <svg
      class={cls ? `pixel-text ${cls}` : 'pixel-text'}
      viewBox={`0 0 ${width} ${height}`}
      width={width * 4}
      height={height * 4}
      preserveAspectRatio="xMinYMin meet"
      shape-rendering="crispEdges"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label ?? text}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
          {stops.map((s, i) => (
            <stop key={i} offset={i / Math.max(1, stops.length - 1)} stop-color={s} />
          ))}
        </linearGradient>
      </defs>
      <path d={toPath(cells)} fill={`url(#${id})`} />
    </svg>
  );
}
