// The committed cloud isosurface meshes the sync copies, declared.

import { defineSource } from '../util/sources/source';

export const CLOUD_SURFACES_BIN = defineSource({
  file: 'data/molecular-clouds/cloud-surfaces.bin',
  hint: 'Regenerate it offline with `pnpm run build:cloud-surfaces`.',
  parse: (input) => input.path,
});
