// The WebGPU implementation of the Local Group emission material seam
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

/**
 * Every uniform this layer reads is already in the shared node mirror —
 * the six HDR emitter slots and `uWorldOffset` — so neither pass owns a
 * uniform record and the slot map it hands back is empty.
 *
 * That includes `uWorldOffset`, which the WebGL layer keeps as its OWN
 * object and copies into from `update()`. On this backend that copy goes
 * nowhere and `FloatingOrigin`'s write to the shared map reaches the
 * mirror instead — the same number by a shorter route
 * (`README.md` § The layer's own uWorldOffset is inert here).
 */
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
