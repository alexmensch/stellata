// The Local Group emission material seam's factory
// (../../local-group/emission/README.md § The material seam).

import type {
  LgEmissionMaterials,
} from '../../local-group/emission/lg-emission-materials';
import type { EmitterMaterial } from '../../scene/emitter-material';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { buildLocalGroupEmissionMaterial } from './local-group-emission-tsl';

export interface TslLgConfig {
  nodes: SharedUniformNodes;
  registerMrtLayer(layer: MrtOutputLayer): () => void;
}

/** README.md § Neither pass owns a uniform. */
export function makeTslLgEmissionMaterials(cfg: TslLgConfig): LgEmissionMaterials {
  return {
    emission(isDisc: boolean): EmitterMaterial {
      const built = buildLocalGroupEmissionMaterial(cfg.nodes, isDisc);
      const unregister = cfg.registerMrtLayer(built);
      return {
        material: built.material,
        uniforms: {},
        dispose() {
          unregister();
          built.material.dispose();
        },
      };
    },
  };
}
