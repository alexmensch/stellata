// DustParticleMaterials test double. See README.md § The material seam.

import { surfaceRecorder, type FakeEmitterMaterial } from '../scene/emitter-material-mock';
import type { DustParticleMaterials } from './dust-particle-layer';

export interface FakeDustParticleMaterials extends DustParticleMaterials {
  /** One per `dustParticles()` call, in build order. */
  readonly surfaces: FakeEmitterMaterial[];
}

export function fakeDustParticleMaterials(): FakeDustParticleMaterials {
  const recorder = surfaceRecorder((surface) => {
    surface.uniforms.uParticleStrength.value = 0;
  });
  return { surfaces: recorder.surfaces, dustParticles: () => recorder.mint() };
}
