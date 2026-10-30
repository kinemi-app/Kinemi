// Where an account's studio is cached in this browser. Small on purpose: the shell needs it before sync loads.
import { STUDIO_SLOT } from '../store';

export const studioKeyFor = (uid: string) => `${STUDIO_SLOT}:${uid}`;
