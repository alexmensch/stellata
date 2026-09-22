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

function dynamic(array: Float32Array, itemSize: number): THREE.BufferAttribute {
  const attr = new THREE.BufferAttribute(array, itemSize);
  attr.setUsage(THREE.DynamicDrawUsage);
  return attr;
}

/** The arrays are the caller's and must outlive these handles — they are
 *  wrapped, not copied. See README.md § Files. */
export function buildStarSourceAttributes(arrays: StarSourceArrays): StarSourceAttributes {
  return {
    iPositionAttr: dynamic(arrays.localPositions, 3),
    iCompositeSuppressAttr: dynamic(arrays.compositeSuppress, 1),
    iEclipseDimAttr: dynamic(arrays.eclipseDim, 1),
    iSuppressPulsationAttr: dynamic(arrays.suppressPulsation, 1),
  };
}
