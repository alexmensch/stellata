// Mirrors data/dust/ (LFS-tracked source of truth) → public/dust/
// (gitignored) so Vite + the Cloudflare static-asset build serve the
// voxel chunks.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { DUST_MIRROR } from './dust-mirror-source';

mirrorDataFolder(DUST_MIRROR.read(), { dstDir: 'public/dust', label: 'dust' });
