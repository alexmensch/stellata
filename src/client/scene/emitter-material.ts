// The renderer-neutral contract a layer's shader surface is built
// through. See README.md § The material seam.

import type * as THREE from 'three';

/**
 * A shader surface and the slots its layer drives.
 *
 * The layer writes `uniforms`, never `material.uniforms` — a TSL uniform
 * node carries `.value` exactly as an `IUniform` does, so the same
 * per-frame write reaches either backend and no layer learns which one it
 * has.
 */
export interface EmitterMaterial {
  readonly material: THREE.Material;
  readonly uniforms: Record<string, THREE.IUniform>;
  /** Frees the material and, on WebGPU, its MRT-mode registration. */
  dispose(): void;
}
