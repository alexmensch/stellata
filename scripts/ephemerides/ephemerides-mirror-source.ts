// The data/ files build:ephemerides-sync copies, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './ephemerides-mirror-outputs';

export const EPHEMERIDES_MIRROR = mirrorSource({
  dir: 'data/ephemerides',
  hint: 'Re-run `pnpm run fetch:ephemerides`.',
  outputs: MIRROR_OUTPUTS,
});
