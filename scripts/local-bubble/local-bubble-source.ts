// The committed Local Bubble shell mesh the sync copies, declared.

import { defineSource } from '../util/sources/source';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const LOCAL_BUBBLE_BIN = defineSource({
  file: `data/local-bubble/${PUBLIC_FILES.localBubble}`,
  hint: 'Regenerate it offline with `pnpm run build:local-bubble`.',
  parse: (input) => input.path,
});
