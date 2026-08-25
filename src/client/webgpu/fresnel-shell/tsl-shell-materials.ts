// The WebGPU implementation of the boundary-shell material seam
// (../../fresnel-shell/README.md § The material seam).

import type { ShellMaterials } from '../../fresnel-shell/fresnel-shell';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import { uniformSlotsOf } from '../tsl/uniform-slots';
import { buildFresnelShellMaterial } from './fresnel-shell-tsl';
import { fresnelShellUniformNodes } from './shell-uniform-nodes';

export interface TslShellConfig {
  registerMrtLayer(layer: MrtOutputLayer): () => void;
}

export function makeTslShellMaterials(cfg: TslShellConfig): ShellMaterials {
  return {
    fresnelShell(opts) {
      const nodes = fresnelShellUniformNodes(opts);
      const built = buildFresnelShellMaterial(nodes, opts);
      // Registration keeps the material's output count in lockstep with the
      // pipeline's target mode; dispose must sever it or a dead material
      // keeps taking mode swaps (`../README.md` § Who releases what).
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
