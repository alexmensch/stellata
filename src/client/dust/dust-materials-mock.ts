// DustParticleMaterials test double. See README.md § The material seam.

import { fakeEmitterMaterial } from '../scene/emitter-material-mock';
import type { EmitterMaterial } from '../scene/emitter-material';
import type { DustParticleMaterials } from './dust-particle-layer';

export interface FakeDustParticleMaterials extends DustParticleMaterials {
  /** One per `dustParticles()` call, in build order. */
  readonly surfaces: EmitterMaterial[];
}

export function fakeDustParticleMaterials(): FakeDustParticleMaterials {
  const surfaces: EmitterMaterial[] = [];
  return {
    surfaces,
    dustParticles() {
      const surface = fakeEmitterMaterial();
      surface.uniforms.uParticleStrength.value = 0;
      surfaces.push(surface);
      return surface;
    },
  };
}
