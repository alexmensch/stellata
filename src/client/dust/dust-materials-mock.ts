// DustParticleMaterials test double. See README.md § The material seam.

import { fakeEmitterMaterial, type FakeEmitterMaterial } from '../scene/emitter-material-mock';
import type { DustParticleMaterials } from './dust-particle-layer';

export interface FakeDustParticleMaterials extends DustParticleMaterials {
  /** One per `dustParticles()` call, in build order. */
  readonly surfaces: FakeEmitterMaterial[];
}

export function fakeDustParticleMaterials(): FakeDustParticleMaterials {
  const surfaces: FakeEmitterMaterial[] = [];
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
