// The data/ file build:cloud-surfaces-sync copies, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './cloud-surfaces-mirror-outputs';

export const CLOUD_SURFACES_MIRROR = mirrorSource({
  dir: 'data/molecular-clouds',
  hint: 'Regenerate it offline with `pnpm run build:cloud-surfaces`.',
  outputs: MIRROR_OUTPUTS,
});
