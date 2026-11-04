// The data/ file build:local-bubble-sync copies, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './local-bubble-mirror-outputs';

export const LOCAL_BUBBLE_MIRROR = mirrorSource({
  dir: 'data/local-bubble',
  hint: 'Regenerate it offline with `pnpm run build:local-bubble`.',
  outputs: MIRROR_OUTPUTS,
});
