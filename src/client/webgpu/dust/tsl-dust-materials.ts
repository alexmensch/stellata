// The dust-particle material seam's factory
// (../../dust/README.md#the-material-seam).

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
