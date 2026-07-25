// Mirrors data/probes/ (committed trajectory JSONs) → public/probes/
// (gitignored) so Vite + the Cloudflare static-asset build serve them.
// Missing data/probes/ is not an error — the layer is optional.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { isProbePublicAsset } from './sync-probes-pure';

mirrorDataFolder({
  srcDir: 'data/probes',
  dstDir: 'public/probes',
  isPublicAsset: isProbePublicAsset,
  label: 'probe',
});
