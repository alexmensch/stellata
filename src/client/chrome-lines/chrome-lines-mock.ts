// ChromeLineMaterials test double. See README.md § Files in this area.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { setBuiltinChromeColour } from '../hdr/chrome/chrome-colour';
import { assembleFatChromeLine, setStrokeOpaque } from './chrome-line-parts';
import type {
  ChromeFatLine, ChromeLineMaterial, ChromeLineMaterials, DashedChromeLineStroke,
  FatChromeLineSpec, FatChromeLineStroke,
} from './chrome-line-materials';

function strokeParams(opacity: number) {
  return { transparent: true, opacity, depthTest: true, depthWrite: false };
}

function handle<M extends THREE.Material & { color: THREE.Color }>(
  material: M, colour: number,
): ChromeLineMaterial<M> {
  setBuiltinChromeColour(material.color, colour);
  return {
    material,
    setOpaque: (on) => setStrokeOpaque(material, on),
    dispose: () => material.dispose(),
  };
}

export function fakeChromeLineMaterials(): ChromeLineMaterials {
  return {
    solid(colour: number, opacity: number) {
      return handle(new THREE.LineBasicMaterial(strokeParams(opacity)), colour);
    },
    dashed(colour: number, dash: number, gap: number, opacity: number) {
      const mat = new THREE.LineDashedMaterial({
        ...strokeParams(opacity), dashSize: dash, gapSize: gap,
      });
      return handle<DashedChromeLineStroke>(mat, colour);
    },
    fat(spec: FatChromeLineSpec): ChromeFatLine {
      const mat = new LineMaterial({
        ...strokeParams(spec.opacity),
        linewidth: spec.widthPx, worldUnits: false,
      });
      const line = assembleFatChromeLine(spec, (geom) => new Line2(geom, mat));
      return {
        ...handle<FatChromeLineStroke>(mat, spec.colour), object: line,
      };
    },
  };
}
