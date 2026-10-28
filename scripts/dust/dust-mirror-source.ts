// The dust voxel chunks the mirror serves, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { isDustPublicAsset } from './sync-dust-pure';

export const DUST_MIRROR = mirrorSource({
  dir: 'data/dust',
  hint: 'Re-run scripts/dust/build-dust.py.',
  isPublicAsset: isDustPublicAsset,
});
