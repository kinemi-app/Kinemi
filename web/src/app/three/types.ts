import type { IconName } from '../../lib/pixel-icons';

export type ModelName = 'orb' | 'camera' | 'voxel' | 'gpu' | 'clapper' | 'reel' | 'previz';

export interface ModelOptions {
  /** voxel: which tool icon */
  icon?: IconName;
  /** voxel: animate (hover) */
  active?: boolean;
  /** orb: 'idle' | 'listening' | 'thinking' */
  mood?: 'idle' | 'listening' | 'thinking';
  /** clapper: bump to snap the sticks */
  clap?: number;
  /** previz: set, move and lens */
  set?: string;
  move?: string;
  lens?: string;
  /** turn slowly on its own */
  spin?: boolean;
}
