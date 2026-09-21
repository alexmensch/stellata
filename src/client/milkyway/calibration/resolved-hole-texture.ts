// The resolution hole as the filtered texture both shaders fetch.
// README.md § The resolution hole.

import * as THREE from 'three';
import {
  RESOLVED_HOLE_BANDS,
  RESOLVED_HOLE_SHELLS,
  unresolvedHoleTexels,
} from './resolved-fraction-pure';

/** Every parameter here is load-bearing, none a default — README.md
 *  § The table is a texture, not a uniform array. */
export function makeResolvedHoleTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint16Array(RESOLVED_HOLE_SHELLS * RESOLVED_HOLE_BANDS),
    RESOLVED_HOLE_SHELLS,
    RESOLVED_HOLE_BANDS,
    THREE.RedFormat,
    THREE.HalfFloatType,
  );
  tex.name = 'unresolvedLight';
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** In place, never by reassignment: both backends hold the texture object
 *  by reference from the moment the material graph is built. */
export function writeResolvedHoleTexture(tex: THREE.DataTexture, strength = 1): void {
  const texels = unresolvedHoleTexels(strength);
  const data = tex.image.data as Uint16Array;
  for (let i = 0; i < texels.length; i++) data[i] = THREE.DataUtils.toHalfFloat(texels[i]);
  tex.needsUpdate = true;
}
