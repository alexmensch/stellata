// The per-star A_V cache as the integration shell holds it, implemented
// once per backend (extinction-prepass.ts, ../../webgpu/extinction/).

import type * as THREE from 'three';

/** Uniform value-objects shared by reference with the star pipeline's
 *  sharedUniforms map: the dust-field inputs the prepass march reads,
 *  and the two consumer uniforms it owns the writes to. */
export interface ExtinctionPrepassUniforms {
  uDustTexture: { value: THREE.Data3DTexture | null };
  uDustBoundsPc: { value: number };
  uDustDensityMin: { value: number };
  uDustLogRatio: { value: number };
  uDustAvPerDensityPc: { value: number };
  uAvPrepassTex: { value: THREE.Texture | null };
  uAvPrepassEnabled: { value: number };
}

export interface ExtinctionPrepassSeam {
  /** False only where the backend cannot render a float target — WebGL2
   *  without EXT_color_buffer_float. Constant true on WebGPU, where float
   *  render targets are core. An unsupported instance is inert and the
   *  star vertex stage stays on its in-vertex raymarch fallback. */
  readonly supported: boolean;
  /** Invalidate the cache — next update() recomputes regardless of
   *  camera displacement. Called on dust attach and per chunk upload. */
  markDirty(): void;
  /** Dev-console A/B switch: false parks the star vertex stage on the
   *  in-vertex raymarch fallback and pauses cache maintenance, so the
   *  fallback side of the comparison never pays fill cost. */
  setEnabled(on: boolean): void;
  /** Whether the star vertex stage is consuming the cache this frame. */
  isActive(): boolean;
  /** Per-frame hook, taking the camera's absolute (heliocentric ICRS)
   *  position before the main render. Recomputes when dirty or the camera
   *  moved beyond RECOMPUTE_EPSILON_PC; otherwise free. */
  update(absCamX: number, absCamY: number, absCamZ: number): void;
  /** Raw physical A_V for one star, out of the very texel the star vertex
   *  stage fetches. Null when the cache is inert, and on WebGPU also on a
   *  cold read — that backend has no synchronous readback, so the value
   *  lands a frame or two later (`../../webgpu/extinction/README.md`
   *  § Cold reads). Event-rate only: never sweep it over the catalog. */
  readAvMag(idx: number): number | null;
  dispose(): void;
}
