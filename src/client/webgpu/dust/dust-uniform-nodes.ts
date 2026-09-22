// The dust sprite's one layer-owned slot, as a TSL node
// (../../dust/dust-particle-layer.ts) — the other six bind off the shared
// uniform-node mirror.

import { uniform } from 'three/tsl';

export function dustParticleUniformNodes() {
  return {
    /** 0 = shelved, which is where the layer sits today. */
    uParticleStrength: uniform(0),
  };
}

export type DustParticleNodes = ReturnType<typeof dustParticleUniformNodes>;
