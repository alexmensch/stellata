// The contract the Local Group emission passes are built through.
// See README.md#the-material-seam.

import type { EmitterMaterial } from '../../scene/emitter-material';

export interface LgEmissionMaterials {
  /** One per family. `isDisc` picks the disc profile and its step count;
   *  the Sérsic spheroid pass is the other. */
  emission(isDisc: boolean): EmitterMaterial;
}
