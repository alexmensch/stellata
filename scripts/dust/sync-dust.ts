// Mirrors data/dust/ (LFS-tracked source of truth) → public/dust/
// (gitignored) so Vite + the Cloudflare static-asset build serve the
// voxel chunks.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { isDustPublicAsset } from './sync-dust-pure';

mirrorDataFolder({
  srcDir: 'data/dust',
  dstDir: 'public/dust',
  isPublicAsset: isDustPublicAsset,
  label: 'dust',
});
