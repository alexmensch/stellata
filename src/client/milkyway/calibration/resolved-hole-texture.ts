// The resolution hole as the filtered texture both shaders fetch.
// README.md § The resolution hole.

import * as THREE from 'three';
import {
  RESOLVED_HOLE_GRID_N,
  unresolvedHoleVoxels,
} from './resolved-fraction-pure';

/** Every parameter here is load-bearing, none a default — README.md
 *  § The table is a texture, not a uniform array. */
export function makeResolvedHoleTexture(): THREE.Data3DTexture {
  const n = RESOLVED_HOLE_GRID_N;
  const tex = new THREE.Data3DTexture(new Uint16Array(n * n * n), n, n, n);
  tex.name = 'unresolvedLight';
  tex.format = THREE.RedFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  return tex;
}

/** In place, never by reassignment: both backends hold the texture object
 *  by reference from the moment the material graph is built. */
export function writeResolvedHoleTexture(
  tex: THREE.Data3DTexture,
  strength = 1,
): void {
  const voxels = unresolvedHoleVoxels(strength);
  const data = tex.image.data as Uint16Array;
  for (let i = 0; i < voxels.length; i++) data[i] = THREE.DataUtils.toHalfFloat(voxels[i]);
  tex.needsUpdate = true;
}
