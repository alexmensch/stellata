// The WebGPU implementation of the chrome line seam
// (../../chrome-lines/README.md): each stroke's TSL graph and its
// registration for the output-struct swap.

import { setBuiltinChromeColour } from '../../hdr/chrome/chrome-colour';
import type {
  ChromeLineMaterial, ChromeLineMaterials, ChromeLineStroke,
  DashedChromeLineStroke,
} from '../../chrome-lines/chrome-line-materials';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import {
  buildChromeLineMaterial, buildDashedChromeLineMaterial,
} from './chrome-line-tsl';

export interface TslChromeLineConfig {
  nodes: SharedUniformNodes;
  registerMrtLayer(layer: MrtOutputLayer): () => void;
}

function wrap<M extends ChromeLineStroke>(
  cfg: TslChromeLineConfig,
  built: MrtEmitterMaterial & { material: M },
  colour: number,
): ChromeLineMaterial<M> {
  setBuiltinChromeColour(built.material.color, colour);
  const unregister = cfg.registerMrtLayer(built);
  return {
    material: built.material,
    dispose() {
      unregister();
      built.material.dispose();
    },
  };
}

/** `localPass` is inert here — `../../chrome-lines/README.md`
 *  § `localPass` is a GLSL-only argument. */
export function makeTslChromeLineMaterials(
  cfg: TslChromeLineConfig,
): ChromeLineMaterials {
  return {
    solid(colour: number, opacity: number, _localPass = false) {
      return wrap(cfg, buildChromeLineMaterial(cfg.nodes, opacity), colour);
    },
    dashed(colour: number, dash: number, gap: number, opacity: number) {
      return wrap<DashedChromeLineStroke>(
        cfg, buildDashedChromeLineMaterial(cfg.nodes, dash, gap, opacity), colour);
    },
  };
}
