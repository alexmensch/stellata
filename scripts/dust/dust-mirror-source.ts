// The data/ files build:dust-sync copies, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './dust-mirror-outputs';

export const DUST_MIRROR = mirrorSource({
  dir: 'data/dust',
  hint: 'Re-run `pnpm run build:dust`.',
  outputs: MIRROR_OUTPUTS,
});
