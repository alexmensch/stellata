// The data/ files build:textures-sync copies, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './textures-mirror-outputs';

export const TEXTURES_MIRROR = mirrorSource({
  dir: 'data/textures',
  hint: 'Rebuild with `pnpm run build:textures`.',
  outputs: MIRROR_OUTPUTS,
  flattenSubDirs: ['relief'],
});
