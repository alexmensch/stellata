// The WebGPU implementation of the chrome line seam
// (../../chrome-lines/README.md): each stroke's TSL graph and its
// registration for the output-struct swap.

import { NoBlending, NormalBlending, type Material } from 'three/webgpu';
import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { setBuiltinChromeColour } from '../../hdr/chrome/chrome-colour';
import type {
  ChromeFatLine, ChromeLineMaterial, ChromeLineMaterials, ChromeLineStroke,
  DashedChromeLineStroke, FatChromeLineSpec, FatChromeLineStroke,
} from '../../chrome-lines/chrome-line-materials';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import {
  buildChromeLineMaterial, buildDashedChromeLineMaterial, buildFatChromeLineMaterial,
  setFatChromeLineOpaque,
} from './chrome-line-tsl';

export interface TslChromeLineConfig {
  nodes: SharedUniformNodes;
  registerMrtLayer(layer: MrtOutputLayer): () => void;
}

function setNodeOpaque(material: Material, on: boolean) {
  material.transparent = !on;
  material.blending = on ? NoBlending : NormalBlending;
  material.needsUpdate = true;
}

function wrap<M extends ChromeLineStroke>(
  cfg: TslChromeLineConfig,
  built: MrtEmitterMaterial & { material: M },
  colour: number,
  setOpaque: (on: boolean) => void = (on) => setNodeOpaque(built.material, on),
): ChromeLineMaterial<M> {
  setBuiltinChromeColour(built.material.color, colour);
  const unregister = cfg.registerMrtLayer(built);
  return {
    material: built.material,
    setOpaque,
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
    fat(spec: FatChromeLineSpec): ChromeFatLine {
      const built = buildFatChromeLineMaterial(cfg.nodes, spec.opacity, spec.widthPx);
      const geom = new LineGeometry();
      geom.setPositions(spec.points);
      const line = new Line2(geom, built.material);
      line.computeLineDistances();
      line.frustumCulled = false;
      line.renderOrder = spec.renderOrder;
      return {
        ...wrap<FatChromeLineStroke>(
          cfg, built, spec.colour, (on) => setFatChromeLineOpaque(built.material, on)),
        object: line,
      };
    },
  };
}
