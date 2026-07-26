// Mirrors data/ephemerides/ (committed element tables) → public/ephemerides/
// (gitignored) so Vite + the Cloudflare static-asset build serve them. A
// missing source folder is not an error — the runtime falls back to Standish.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { isPlanetElementPublicAsset } from './sync-ephemerides-pure';

mirrorDataFolder({
  srcDir: 'data/ephemerides',
  dstDir: 'public/ephemerides',
  isPublicAsset: isPlanetElementPublicAsset,
  label: 'planet element table',
});
