// Mirrors data/ephemerides/ (committed element tables) → public/ephemerides/
// (gitignored) so Vite + the Cloudflare static-asset build serve them.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { EPHEMERIDES_MIRROR } from './ephemerides-mirror-source';

mirrorDataFolder(EPHEMERIDES_MIRROR.read(), { dstDir: 'public/ephemerides', label: 'planet element table' });
