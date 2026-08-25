// The WebGPU implementation of the band material seam
// (../../milkyway/README.md § The material seam).

import type {
  BandMaterials, BandSharedSlots,
} from '../../milkyway/band-materials';
import type { EmitterMaterial } from '../../solar-system/materials/emitter-material';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { uniformSlotsOf } from '../tsl/uniform-slots';
import { bandComponentUniformNodes, bandSharedUniformNodes } from './band-uniform-nodes';
import { buildMilkyWayBandMaterial } from './milkyway-band-tsl';

export interface TslBandConfig {
  nodes: SharedUniformNodes;
  registerMrtLayer(layer: MrtOutputLayer): () => void;
}

/**
 * The shared nodes are built ONCE here and handed to both components, so
 * the disc and the bulge take the same objects and one write through
 * either's slot record reaches both draws — the WebGL layout, transcribed.
 * A factory per component would give two independent dust models that
 * happened to agree until the first slider move.
 */
export function makeTslBandMaterials(cfg: TslBandConfig): BandMaterials {
  const sharedNodes = bandSharedUniformNodes();
  const sharedSlots = uniformSlotsOf(sharedNodes) as unknown as BandSharedSlots;

  return {
    shared: sharedSlots,
    component(spec): EmitterMaterial {
      const componentNodes = bandComponentUniformNodes(spec);
      const built = buildMilkyWayBandMaterial(
        cfg.nodes, sharedNodes, componentNodes, spec.isBulge);
      const unregister = cfg.registerMrtLayer(built);
      return {
        material: built.material,
        // Both records, so a layer that writes a per-component slot and a
        // shared one through the same handle reaches each — exactly what
        // the WebGL uniforms map does by spreading them together.
        uniforms: { ...sharedSlots, ...uniformSlotsOf(componentNodes) },
        dispose() {
          unregister();
          built.material.dispose();
        },
      };
    },
  };
}
