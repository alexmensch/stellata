// The committed cloud isosurface meshes the sync copies, declared.

import { defineSource } from '../util/sources/source';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const CLOUD_SURFACES_BIN = defineSource({
  file: `data/molecular-clouds/${PUBLIC_FILES.cloudSurfaces}`,
  hint: 'Regenerate it offline with `pnpm run build:cloud-surfaces`.',
  parse: (input) => input.path,
});
