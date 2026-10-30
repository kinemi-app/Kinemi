// A camera move, drawn as a tiny animated viewfinder over a pixel subject.
import type { MoveFx } from '../data/moves';
import type { UiIconName } from '../lib/px-icons';
import { PxIcon } from '../ui/icons';

const MINI: Record<MoveFx, [UiIconName, number]> = {
  in: ['plus', 0],
  out: ['minus', 0],
  left: ['arrow-right', 180],
  right: ['arrow-right', 0],
  up: ['arrow-right', -90],
  down: ['arrow-right', 90],
  'pan-l': ['chevron-left', 0],
  'pan-r': ['chevron-right', 0],
  'tilt-u': ['chevron-up', 0],
  'tilt-d': ['chevron-down', 0],
  'orbit-l': ['refresh', 180],
  'orbit-r': ['refresh', 0],
  'zoom-in': ['plus', 0],
  'zoom-out': ['minus', 0],
  shake: ['more', 0],
  roll: ['refresh', 90],
  focus: ['eye', 0],
  speed: ['bolt', 0],
  static: ['pause', 0],
};

export function MoveDiagram({ fx, size = 'md' }: { fx: MoveFx; size?: 'xs' | 'md' }) {
  if (size === 'xs') {
    const [icon, rot] = MINI[fx];
    return (
      <span class="mvd-xs" style={{ transform: `rotate(${rot}deg)` }} aria-hidden="true">
        <PxIcon name={icon} size={10} />
      </span>
    );
  }
  return (
    <span class="mvd" data-fx={fx} aria-hidden="true">
      <span class="mvd-floor" />
      <span class="mvd-subject">
        <i />
        <i />
      </span>
      <span class="mvd-frame">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
