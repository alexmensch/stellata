// Mirrors data/probes/ (committed trajectory JSONs) → public/probes/
// (gitignored) so Vite + the Cloudflare static-asset build serve them.

import { mirrorDataFolder } from '../util/mirror-to-public';
import { PUBLIC_FOLDERS, publicRepoPath } from '../../src/catalog-format/public-artifacts/public-artifacts';

import { PROBES_MIRROR } from './probes-mirror-source';

mirrorDataFolder(PROBES_MIRROR.read(), { dstDir: publicRepoPath(PUBLIC_FOLDERS.probes), label: 'probe' });
