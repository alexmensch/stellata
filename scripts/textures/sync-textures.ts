// Mirrors data/textures/ (committed artifacts) → public/textures/
// (gitignored) so Vite + the Cloudflare static-asset build serve the
// per-body maps. Missing data/textures/ is not an error.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { isTexturePublicAsset } from './sync-textures-pure';

mirrorDataFolder({
  srcDir: 'data/textures',
  dstDir: 'public/textures',
  isPublicAsset: isTexturePublicAsset,
  label: 'texture',
  // relief/ groups the big DEM-derived maps at rest; they still serve from
  // public/textures/ alongside the colour rungs, so no renderer URL moves.
  flattenSubDirs: ['relief'],
});
