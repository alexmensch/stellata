// The per-star A_V cache as the integration shell holds it; implemented
// behind the import boundary in ../../webgpu/extinction/.

import type * as THREE from 'three';
import type { AvParityReport } from './av-parity-pure';

/** Uniform value-objects shared by reference with the star pipeline's
 *  sharedUniforms map: the dust-field inputs the prepass march reads,
 *  and the two consumer uniforms it owns the writes to. */
export interface ExtinctionPrepassUniforms {
  uDustTexture: { value: THREE.Data3DTexture | null };
  uDustBoundsPc: { value: number };
  uDustDensityMin: { value: number };
  uDustLogRatio: { value: number };
  uDustAvPerDensityPc: { value: number };
  uAvPrepassEnabled: { value: number };
}

/** see ../../webgpu/extinction/refill/README.md#only-what-is-in-frame */
export interface ExtinctionView {
  camera: THREE.Camera;
  worldOffset: THREE.Vector3;
}

export interface ExtinctionPrepassSeam {
  /** Invalidate the cache — next update() recomputes regardless of
   *  camera displacement. Called on dust attach and per chunk upload. */
  markDirty(): void;
  /** Re-pack the position table off `catalog.positions` and invalidate —
   *  README.md#the-prepass-cache. */
  refreshPositions(): void;
  /** Dev-console A/B switch: false parks the star vertex stage on the
   *  in-vertex raymarch fallback and pauses cache maintenance, so the
   *  fallback side of the comparison never pays fill cost. */
  setEnabled(on: boolean): void;
  /** Whether the star vertex stage is consuming the cache this frame. */
  isActive(): boolean;
  /** Per-frame hook, taking the camera's absolute (heliocentric ICRS)
   *  position before the main render. Refills when dirty or the camera moved
   *  beyond RECOMPUTE_EPSILON_PC, and when the view turned — a turn is an
   *  ordinary refill request
   *  (`../../webgpu/extinction/refill/README.md#a-view-change-is-a-refill-request--nothing-more`).
   * Free only with the camera parked and the view still. */
  update(absCamX: number, absCamY: number, absCamZ: number, view?: ExtinctionView): void;
  /** Raw physical A_V for one star, out of the buffer the star vertex
   *  stage fetches. Null when the cache is inert, and until
   *  `warmAvReadback` has landed the table
   *  (`../../webgpu/extinction/README.md#cold-reads--the-one-behaviour-that-is-not-parity`). */
  readAvMag(idx: number): number | null;
  /** A pick is imminent, so stage the whole A_V table onto the CPU before
   *  anything asks for it. One mapped copy of the buffer, at most one per
   *  recompute and none while the camera is under way, and the pointer
   *  dwell covers its latency — which is what lets `readAvMag` answer the
   *  first pick exactly rather than a jiggle later. */
  warmAvReadback(): void;
  /** How many catalogue stars the refill's frustum test admits
   *  at the view it last dispatched with — the population that pays the
   *  gate reads (`../../webgpu/extinction/refill/README.md#counting-the-in-frame-population`).
   * Null until a view has been supplied. */
  countInFrame(): number | null;
  /** March every star once more as a fragment pass and
   *  bit-compare against the compute kernel's buffer. Null while the cache
   *  is inert. Dev-console only — it reads the whole buffer back. */
  verifyParity(): Promise<AvParityReport | null>;
  dispose(): void;
}
