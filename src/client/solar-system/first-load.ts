// Canonical no-URL first-load view: Earth from 8.8 million km, held against its
// own orbit by the lock. See
// /src/client/solar-system/README.md#first-load-default-and-mindistance-relaxation.

import { applyDecodedView, type DecodedView, type IdMaps } from '../util/url-state';
import type { Stellata } from '../stellata';
import { SOL_OBJECT_SIDS } from './sol-object-sids';

export const FIRST_LOAD_VIEW: DecodedView = {
  focus: { kind: 'sid', id: SOL_OBJECT_SIDS.earth },
  cam: [-1.655275e-7, -2.197143e-7, 7.73263e-8],
  up: [0.43949, -0.01501, 0.89812],
  showHud: true,
  orb: true,
  orbLock: true,
  orbitPose: true,
};

export function applyFirstLoadView(stellata: Stellata, idMaps: IdMaps): void {
  applyDecodedView(stellata, FIRST_LOAD_VIEW, idMaps);
}
