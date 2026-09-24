// The WebGPU implementation of the cloud material seam
// (../../molecular-clouds/README.md#the-material-seam).

import type { CloudMaterials } from '../../molecular-clouds/cloud-materials';
import type { EmitterMaterial } from '../../scene/emitter-material';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { uniformSlotsOf } from '../tsl/uniform-slots';
import { buildCloudAbsorptionMaterial } from './cloud-absorption-tsl';
import { buildCloudRimMaterial } from './cloud-rim-tsl';
import {
  cloudAbsorptionUniformNodes, cloudFieldUniformNodes, cloudRimUniformNodes,
} from './cloud-uniform-nodes';

export interface TslCloudConfig {
  nodes: SharedUniformNodes;
  registerMrtLayer(layer: MrtOutputLayer): () => void;
}

export function makeTslCloudMaterials(cfg: TslCloudConfig): CloudMaterials {
  const wrap = (
    built: MrtEmitterMaterial,
    nodes: Record<string, unknown>,
  ): EmitterMaterial => {
    // Registration keeps the material's output count in lockstep with the
    // pipeline's target mode; dispose must sever it or a dead material
    // keeps taking mode swaps (`../README.md#who-releases-what`).
    const unregister = cfg.registerMrtLayer(built);
    return {
      material: built.material,
      uniforms: uniformSlotsOf(nodes),
      dispose() {
        unregister();
        built.material.dispose();
      },
    };
  };

  return {
    absorption(spec) {
      const nodes = cloudAbsorptionUniformNodes(spec);
      const field = spec.field === null ? null : cloudFieldUniformNodes(spec.field);
      const built = buildCloudAbsorptionMaterial(cfg.nodes, nodes, field);
      // `field` is deliberately withheld from the written record
      // (README.md#the-shared-pair-is-not-in-this-record).
      return wrap(built, nodes);
    },

    rim(spec) {
      const nodes = cloudRimUniformNodes(spec.inkHex, spec.inkAlpha, spec.opacity);
      return wrap(buildCloudRimMaterial(nodes), nodes);
    },
  };
}
