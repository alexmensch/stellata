// Mirrors data/ephemerides/ (committed element tables) → public/ephemerides/
// (gitignored) so Vite + the Cloudflare static-asset build serve them.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { isPlanetElementPublicAsset } from './sync-ephemerides-pure';

mirrorDataFolder({
  srcDir: 'data/ephemerides',
  dstDir: 'public/ephemerides',
  isPublicAsset: isPlanetElementPublicAsset,
  label: 'planet element table',
});
