// Mirrors data/probes/ (committed trajectory JSONs) → public/probes/
// (gitignored) so Vite + the Cloudflare static-asset build serve them.

import { mirrorDataFolder } from '../util/mirror-to-public';
import { publicRepoPath } from '../util/paths';
import { PUBLIC_FOLDERS } from '../../src/catalog-format/public-artifacts/public-artifacts';

import { PROBES_MIRROR } from './probes-mirror-source';

mirrorDataFolder(PROBES_MIRROR.read(), { dstDir: publicRepoPath(PUBLIC_FOLDERS.probes), label: 'probe' });
