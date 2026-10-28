// The per-body maps the mirror serves, declared.

import { mirrorSource } from '../util/mirror-to-public';
import { isTexturePublicAsset } from './sync-textures-pure';

export const TEXTURES_MIRROR = mirrorSource({
  dir: 'data/textures',
  hint: 'Rebuild with `pnpm run build:textures`.',
  isPublicAsset: isTexturePublicAsset,
  // relief/ groups the big DEM-derived maps at rest; they still serve from
  // public/textures/ alongside the colour rungs, so no renderer URL moves.
  flattenSubDirs: ['relief'],
});
