// The WebGL2 half of the chrome line seam: three's built-in line
// materials. See README.md.

import * as THREE from 'three';
import { setBuiltinChromeColour } from '../hdr/chrome/chrome-colour';
import type {
  ChromeLineMaterial, ChromeLineMaterials, DashedChromeLineStroke,
} from './chrome-line-materials';

function strokeParams(opacity: number) {
  return { transparent: true, opacity, depthTest: true, depthWrite: false };
}

function handle<M extends THREE.Material & { color: THREE.Color }>(
  material: M, colour: number,
): ChromeLineMaterial<M> {
  setBuiltinChromeColour(material.color, colour);
  return { material, dispose: () => material.dispose() };
}

/**
 * `localPass` strips the built-in log-depth chunks so fragments keep
 * standard bracket depth — required for any line rendered in the local
 * depth pass (`../local-depth/README.md`).
 */
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
  };
}
