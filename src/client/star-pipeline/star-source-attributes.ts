// The four per-star buffers the shell rewrites and the star layer
// forwards to the GPU.

import * as THREE from 'three';

export interface StarSourceArrays {
  /** Rewritten in place by every floating-origin recentre. */
  localPositions: Float32Array;
  /** Rewritten each frame by `BinaryOrbitField` — 1.0 collapses a
   *  sub-pixel binary secondary's disc and core mask. */
  compositeSuppress: Float32Array;
  /** Rewritten each frame by `EclipsePhotometryField` — < 1.0 dims the
   *  back component's glow through a transit. */
  eclipseDim: Float32Array;
  /** Built once per attachBinaries from `varType` alone; 1.0 zeros the
   *  GCVS-amplitude radial pulsation
   *  (`../binaries/eclipse/README.md` § Pulsation gate). */
  suppressPulsation: Float32Array;
}

export interface StarSourceAttributes {
  iPositionAttr: THREE.BufferAttribute;
  iCompositeSuppressAttr: THREE.BufferAttribute;
  iEclipseDimAttr: THREE.BufferAttribute;
  iSuppressPulsationAttr: THREE.BufferAttribute;
}

/** The arrays are the caller's and must outlive these handles — they are
 *  wrapped, not copied. Nothing instances them into a geometry: the star
 *  layer reads each one's `needsUpdate` and update ranges to drive its own
 *  storage-buffer writes (`../webgpu/star/README.md`). See README.md
 *  § Files. */
export function buildStarSourceAttributes(arrays: StarSourceArrays): StarSourceAttributes {
  return {
    iPositionAttr: new THREE.BufferAttribute(arrays.localPositions, 3),
    iCompositeSuppressAttr: new THREE.BufferAttribute(arrays.compositeSuppress, 1),
    iEclipseDimAttr: new THREE.BufferAttribute(arrays.eclipseDim, 1),
    iSuppressPulsationAttr: new THREE.BufferAttribute(arrays.suppressPulsation, 1),
  };
}
