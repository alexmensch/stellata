// The probe trajectories the mirror serves, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { isProbePublicAsset } from './sync-probes-pure';

export const PROBES_MIRROR = mirrorSource({
  dir: 'data/probes',
  hint: 'Re-run `pnpm run fetch:probes`.',
  isPublicAsset: isProbePublicAsset,
});
