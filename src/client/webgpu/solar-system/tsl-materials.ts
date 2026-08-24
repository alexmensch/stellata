// The WebGPU implementation of the solar-system material seam
// (../../solar-system/materials/README.md): each surface's TSL graph, its
// uniform-node record, and its registration for the output-struct swap.

import type * as THREE from 'three';
import type {
  EmitterMaterial, ProbeMaterials, SolarSystemMaterials,
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
    ownedTextures: readonly THREE.Texture[] = [],
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
        // The per-slot stand-ins (uniform-nodes.ts slotPlaceholder), never
        // whatever a loaded map later swapped in — those belong to
        // PlanetMeshLayer's texture cache, which disposes them itself.
        for (const t of ownedTextures) t.dispose();
      },
    };
  };
}

/**
 * The glyph alone. Reversed-z deleted the only thing that differed
 * between the main-pass and mirror variants, so both draws share ONE
 * material rather than compiling two identical graphs — `localPass` is
 * inert here (`README.md` § The probe glyph needs no mirror variant).
 *
 * Sharing makes dispose refcounted: the probe field builds both variants
 * and disposes both, and the material must outlive the first of those.
 */
export function makeTslProbeMaterial(cfg: TslProbeConfig): ProbeMaterials {
  const wrap = wrapper(cfg);
  let shared: EmitterMaterial | null = null;
  let holders = 0;
  return {
    probeMarker(_localPass: boolean) {
      if (shared === null) {
        const nodes = probeMarkerUniformNodes();
        shared = wrap(buildProbeMarkerMaterial(cfg.nodes, nodes), nodes);
      }
      const built = shared;
      holders++;
      return {
        material: built.material,
        uniforms: built.uniforms,
        dispose() {
          holders--;
          if (holders > 0) return;
          shared = null;
          built.dispose();
        },
      };
    },
  };
}

export function makeTslSolarSystemMaterials(
  cfg: TslMaterialConfig,
): SolarSystemMaterials {
  const wrap = wrapper(cfg);
  return {
    planetMesh() {
      const owned: THREE.Texture[] = [];
      const nodes = planetMeshUniformNodes(cfg.placeholder, owned);
      return wrap(buildPlanetMeshMaterial(cfg.nodes, nodes, cfg.gates), nodes, owned);
    },
    planetRings() {
      const owned: THREE.Texture[] = [];
      const nodes = planetRingsUniformNodes(cfg.placeholder, owned);
      return wrap(buildPlanetRingsMaterial(cfg.nodes, nodes, cfg.gates), nodes, owned);
    },
    planetAtmosphere() {
      const nodes = planetAtmosphereUniformNodes();
      return wrap(buildPlanetAtmosphereMaterial(cfg.nodes, nodes, cfg.gates), nodes);
    },
  };
}
