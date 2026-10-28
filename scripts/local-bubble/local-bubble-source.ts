// The committed Local Bubble shell mesh the sync copies, declared.

import { defineSource } from '../util/sources/source';

export const LOCAL_BUBBLE_BIN = defineSource({
  file: 'data/local-bubble/local-bubble.bin',
  hint: 'Regenerate it offline with `pnpm run build:local-bubble`.',
  parse: (input) => input.path,
});
