// The data/ files build:probes-sync copies, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './probes-mirror-outputs';

export const PROBES_MIRROR = mirrorSource({
  dir: 'data/probes',
  hint: 'Re-run `pnpm run fetch:probes`.',
  outputs: MIRROR_OUTPUTS,
});
