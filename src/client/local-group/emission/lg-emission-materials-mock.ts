// LgEmissionMaterials test double. See README.md § The material seam.

import { fakeEmitterMaterial } from '../../scene/emitter-material-mock';
import type { LgEmissionMaterials } from './lg-emission-materials';

export function fakeLgEmissionMaterials(): LgEmissionMaterials {
  return { emission: () => fakeEmitterMaterial() };
}
