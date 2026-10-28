// The planet element tables the mirror serves, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { isPlanetElementPublicAsset } from './sync-ephemerides-pure';

export const EPHEMERIDES_MIRROR = mirrorSource({
  dir: 'data/ephemerides',
  hint: 'Re-run `pnpm run fetch:ephemerides`.',
  isPublicAsset: isPlanetElementPublicAsset,
});
