// The contract the Local Group emission passes are built through.
// See README.md § The material seam.

import * as THREE from 'three';
import type { EmitterMaterial } from '../../scene/emitter-material';
import type { HdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { EMISSION_STEPS_DISC, EMISSION_STEPS_SERSIC } from './local-group-emission-pure';

export interface LgEmissionMaterials {
  /** One per family. `isDisc` picks the disc profile and its step count;
   *  the Sérsic spheroid pass is the other. */
  emission(isDisc: boolean): EmitterMaterial;
}
