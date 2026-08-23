// The WebGPU implementation of the solar-system material seam
// (../../solar-system/materials/README.md): each surface's TSL graph, its
// uniform-node record, and its registration for the output-struct swap.

import type * as THREE from 'three';
import type {
  EmitterMaterial, SolarSystemMaterials,
} from '../../solar-system/materials/emitter-material';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import { buildPlanetAtmosphereMaterial } from './planet-atmosphere-tsl';
import { buildPlanetMeshMaterial } from './planet-mesh-tsl';
import { buildPlanetRingsMaterial } from './planet-rings-tsl';
import { buildProbeMarkerMaterial } from './probe-tsl';
import {
  planetAtmosphereUniformNodes, planetMeshUniformNodes,
  planetRingsUniformNodes, probeMarkerUniformNodes, uniformSlotsOf,
} from './uniform-nodes';

export interface TslProbeConfig {
  nodes: SharedUniformNodes;
  registerMrtLayer(layer: MrtOutputLayer): () => void;
}

export interface TslMaterialConfig extends TslProbeConfig {
  gates: EmitterGateNodes;
  /** 1×1 white stand-in every texture slot starts on, so a body with no
   *  map still binds something. */
  placeholder: THREE.Texture;
}

function wrapper(cfg: TslProbeConfig) {
  return (
    built: MrtEmitterMaterial,
    nodes: Record<string, unknown>,
  ): EmitterMaterial => {
    // Registration is what keeps the material's output count in lockstep
    // with the pipeline's target mode; dispose must sever it or a dead
    // material keeps taking mode swaps.
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
}

/** The glyph alone — it reads neither the HDR unit nor a texture, so the
 *  probe field takes it without the planet surfaces' config. */
export function makeTslProbeMaterial(
  cfg: TslProbeConfig,
): Pick<SolarSystemMaterials, 'probeMarker'> {
  const wrap = wrapper(cfg);
  return {
    probeMarker() {
      const nodes = probeMarkerUniformNodes();
      return wrap(buildProbeMarkerMaterial(cfg.nodes, nodes), nodes);
    },
  };
}

export function makeTslSolarSystemMaterials(
  cfg: TslMaterialConfig,
): SolarSystemMaterials {
  const wrap = wrapper(cfg);
  return {
    ...makeTslProbeMaterial(cfg),
    planetMesh() {
      const nodes = planetMeshUniformNodes(cfg.placeholder);
      return wrap(buildPlanetMeshMaterial(cfg.nodes, nodes, cfg.gates), nodes);
    },
    planetRings() {
      const nodes = planetRingsUniformNodes(cfg.placeholder);
      return wrap(buildPlanetRingsMaterial(cfg.nodes, nodes, cfg.gates), nodes);
    },
    planetAtmosphere() {
      const nodes = planetAtmosphereUniformNodes();
      return wrap(buildPlanetAtmosphereMaterial(cfg.nodes, nodes, cfg.gates), nodes);
    },
  };
}
