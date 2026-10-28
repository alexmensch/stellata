// Mirrors data/probes/ (committed trajectory JSONs) → public/probes/
// (gitignored) so Vite + the Cloudflare static-asset build serve them.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { PROBES_MIRROR } from './probes-mirror-source';

mirrorDataFolder(PROBES_MIRROR.read(), { dstDir: 'public/probes', label: 'probe' });
