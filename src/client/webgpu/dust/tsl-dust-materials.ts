// The WebGPU implementation of the dust-particle material seam
// (../../dust/README.md § The material seam).

import type { DustParticleMaterials } from '../../dust/dust-particle-layer';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { uniformSlotsOf } from '../tsl/uniform-slots';
import { buildDustParticleMaterial } from './dust-particle-tsl';
import { dustParticleUniformNodes } from './dust-uniform-nodes';

export interface TslDustConfig {
  nodes: SharedUniformNodes;
  registerMrtLayer(layer: MrtOutputLayer): () => void;
}

/**
 * The six shared slots come off the uniform-node mirror rather than the
 * argument: on this backend the WebGL map is not what a shader reads, and
 * the mirror is already the by-reference channel every writer feeds
 * (`../tsl/README.md` § Shared uniform nodes). The argument is ignored for
 * exactly that reason — the seam's shape is the WebGL layer's, not this
 * one's.
 */
export function makeTslDustParticleMaterials(
  cfg: TslDustConfig,
): DustParticleMaterials {
  return {
    dustParticles() {
      const nodes = dustParticleUniformNodes();
      const built = buildDustParticleMaterial(cfg.nodes, nodes);
      const unregister = cfg.registerMrtLayer(built);
      return {
        material: built.material,
        uniforms: uniformSlotsOf(nodes),
        dispose() {
          unregister();
          built.material.dispose();
        },
      };
    },
  };
}
