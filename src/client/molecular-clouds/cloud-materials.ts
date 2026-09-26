// The contract the cloud surfaces are built through.
// See README.md#the-material-seam.

import * as THREE from 'three';
import type { EmitterMaterial } from '../scene/emitter-material';

/** The traced tier: the per-cloud Edenhofer 2024
 *  (/data/papers/index.md#edenhofer2024) density brick and the frame that
 *  maps a cloud-local sample point into it. Its presence is what selects
 *  the brick-marching graph. */
export interface CloudFieldSpec {
  brick: THREE.Data3DTexture;
  densityMax: number;
  /** centerAbs − brick aabbMin, pc. */
  centerFromAabb: THREE.Vector3;
  /** cloud-local → world. */
  rotMat: THREE.Matrix3;
  /** 1 / (stepPc · dims). */
  uvwScale: THREE.Vector3;
  /** 0.5 / dims — texel-centre alignment. */
  uvwBias: THREE.Vector3;
}

/**
 * One cloud's absorption material.
 *
 * The layer builds this — it owns the brick texture's lifetime —
 * so the factories stay pure shader plumbing and the per-cloud constants
 * reach a uniform in exactly one place.
 */
export interface CloudAbsorptionSpec {
  axes: THREE.Vector3;
  n0Cal: number;
  rflatPc: number;
  p: number;
  /** The brick's taper edge on the traced tier, the analytic mass-budget
   *  envelope otherwise — the layer has already decided which. */
  uEnv: number;
  /** Renderer frame → cloud-local frame rotation. */
  invQuat: THREE.Matrix3;
  /** The dev-console step ceiling at construction. */
  steps: number;
  field: CloudFieldSpec | null;
}

/** The rim shell's authored starting values; every one of them is also a
 *  live setter on the layer. */
export interface CloudRimSpec {
  inkHex: number;
  inkAlpha: number;
  opacity: number;
}

export interface CloudMaterials {
  /** One per cloud — the tier is compile-time, so they cannot share. */
  absorption(spec: CloudAbsorptionSpec): EmitterMaterial;
  /** One for every cloud. */
  rim(spec: CloudRimSpec): EmitterMaterial;
}
