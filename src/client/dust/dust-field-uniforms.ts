// The shared-uniform slots the Edenhofer dust texture and its log decode ride
// on, narrowed to what a dust reader needs.

import type * as THREE from 'three';

/** Held by reference from `buildSharedUniforms`, so an attach reaches every
 *  reader at once. The GLSL side of the same contract is the
 *  `stellata_dust_raymarch` chunk's uniform block. */
export interface DustFieldUniforms {
  uDustTexture: { value: THREE.Data3DTexture | null };
  uDustBoundsPc: { value: number };
  uDustDensityMin: { value: number };
  uDustLogRatio: { value: number };
  uDustAvPerDensityPc: { value: number };
}
