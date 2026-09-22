// LgEmissionMaterials test double. See README.md § The material seam.

import { surfaceRecorder, type FakeEmitterMaterial } from '../../scene/emitter-material-mock';
import type { LgEmissionMaterials } from './lg-emission-materials';

export interface FakeLgEmissionMaterials extends LgEmissionMaterials {
  /** One per `emission()` call, in build order. */
  readonly surfaces: FakeEmitterMaterial[];
}

export function fakeLgEmissionMaterials(): FakeLgEmissionMaterials {
  const recorder = surfaceRecorder();
  return { surfaces: recorder.surfaces, emission: () => recorder.mint() };
}
