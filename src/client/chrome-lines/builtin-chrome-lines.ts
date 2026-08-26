// The WebGL2 half of the chrome line seam: three's built-in line
// materials. See README.md.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { setBuiltinChromeColour } from '../hdr/chrome/chrome-colour';
import type {
  ChromeFatLine, ChromeLineMaterial, ChromeLineMaterials, DashedChromeLineStroke,
  FatChromeLineSpec, FatChromeLineStroke,
} from './chrome-line-materials';

function strokeParams(opacity: number) {
  return { transparent: true, opacity, depthTest: true, depthWrite: false };
}

/** The blend flip both stroke shapes share here — the WebGPU fat stroke is
 *  the one that cannot express it this way. */
function setBuiltinOpaque(material: THREE.Material, on: boolean) {
  material.transparent = !on;
  material.blending = on ? THREE.NoBlending : THREE.NormalBlending;
  material.needsUpdate = true;
}

function handle<M extends THREE.Material & { color: THREE.Color }>(
  material: M, colour: number,
): ChromeLineMaterial<M> {
  setBuiltinChromeColour(material.color, colour);
  return {
    material,
    setOpaque: (on) => setBuiltinOpaque(material, on),
    dispose: () => material.dispose(),
  };
}

/** `localPass` — README.md § `localPass` is a GLSL-only argument. */
export function builtinChromeLineMaterials(): ChromeLineMaterials {
  return {
    solid(colour: number, opacity: number, localPass = false) {
      const mat = new THREE.LineBasicMaterial(strokeParams(opacity));
      if (localPass) {
        mat.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace('#include <logdepthbuf_pars_vertex>', '')
            .replace('#include <logdepthbuf_vertex>', '');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <logdepthbuf_pars_fragment>', '')
            .replace('#include <logdepthbuf_fragment>', '');
        };
        mat.customProgramCacheKey = () => 'orbit-line-local-depth';
      }
      return handle(mat, colour);
    },
    dashed(colour: number, dash: number, gap: number, opacity: number) {
      const mat = new THREE.LineDashedMaterial({
        ...strokeParams(opacity), dashSize: dash, gapSize: gap,
      });
      return handle<DashedChromeLineStroke>(mat, colour);
    },
    fat(spec: FatChromeLineSpec): ChromeFatLine {
      // `resolution` is three's own to write — README.md § The fat stroke
      // sizes itself.
      const mat = new LineMaterial({
        transparent: true, opacity: spec.opacity, depthTest: true,
        linewidth: spec.widthPx, worldUnits: false,
      });
      mat.depthWrite = false;
      const geom = new LineGeometry();
      geom.setPositions(spec.points);
      const line = new Line2(geom, mat);
      line.computeLineDistances();
      line.frustumCulled = false;
      line.renderOrder = spec.renderOrder;
      return {
        ...handle<FatChromeLineStroke>(mat, spec.colour), object: line,
      };
    },
  };
}
