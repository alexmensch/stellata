// Mirrors data/textures/ (committed artifacts) → public/textures/
// (gitignored) so Vite + the Cloudflare static-asset build serve the
// per-body maps.

import { mirrorDataFolder } from '../util/mirror-to-public';

import { TEXTURES_MIRROR } from './textures-mirror-source';

mirrorDataFolder(TEXTURES_MIRROR.read(), { dstDir: 'public/textures', label: 'texture' });
