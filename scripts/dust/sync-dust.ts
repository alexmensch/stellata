// Mirrors data/dust/ (LFS-tracked source of truth) → public/dust/
// (gitignored) so Vite + the Cloudflare static-asset build serve the
// voxel chunks.

import { mirrorDataFolder } from '../util/mirror-to-public';
import { PUBLIC_FOLDERS, publicRepoPath } from '../../src/catalog-format/public-artifacts/public-artifacts';

import { DUST_MIRROR } from './dust-mirror-source';

mirrorDataFolder(DUST_MIRROR.read(), { dstDir: publicRepoPath(PUBLIC_FOLDERS.dust), label: 'dust' });
