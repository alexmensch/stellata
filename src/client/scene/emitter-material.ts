// The contract a layer's shader surface is built through. See README.md#the-material-seam.

import type * as THREE from 'three';

/**
 * A shader surface and the slots its layer drives.
 *
 * The layer writes `uniforms`, never `material.uniforms` — a TSL uniform
 * node carries `.value` exactly as an `IUniform` does, so the layer
 * never learns what built it.
 */
export interface EmitterMaterial {
  readonly material: THREE.Material;
  readonly uniforms: Record<string, THREE.IUniform>;
  /** Frees the material and its MRT-mode registration. */
  dispose(): void;
}
