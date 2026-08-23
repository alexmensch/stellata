// The renderer-neutral contract the solar-system surfaces are built
// through: a material plus the uniform slots its layer writes. See
// README.md.

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

/**
 * The solar-system surfaces whose geometry crosses backends unchanged.
 *
 * The reflected-glare billboard is deliberately absent: its 13 per-instance
 * attributes exceed WebGPU's 8 vertex buffers, so it ports as its own
 * packed layer rather than a material swap
 * (`../../webgpu/solar-system/README.md` § The glare packs).
 */
export interface SolarSystemMaterials {
  /** The lit spheroid: equirect sample, terminator, relief, casters, and
   *  the disc-airlight block. Alpha-composited over the diffuse field. */
  planetMesh(): EmitterMaterial;
  /** The ring annulus over its radial strip. */
  planetRings(): EmitterMaterial;
  /** The limb-halo shell, premultiplied-over. */
  planetAtmosphere(): EmitterMaterial;
  /**
   * The fixed-pixel probe glyph. `localPass` selects the mirror variant,
   * which carries no log-depth encoding — on the TSL path reversed-z
   * already deleted that chunk, so both variants are one graph.
   *
   * `viewport` arrives per call rather than on the factory: it is the only
   * frame-shared pair a surface here reads by reference, and the layer
   * that owns the glyph is not the one that owns the planet surfaces.
   */
  probeMarker(
    viewport: { uViewport: THREE.IUniform; uPixelRatio: THREE.IUniform },
    localPass: boolean,
  ): EmitterMaterial;
}
