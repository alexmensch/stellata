// The per-star A_V cache as the integration shell holds it, implemented
// once per backend (extinction-prepass.ts, ../../webgpu/extinction/).

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
  uAvPrepassTex: { value: THREE.Texture | null };
  uAvPrepassEnabled: { value: number };
}

/** Which population the WebGPU refill dispatches over past the first fill:
 *  `sliced` walks the Morton slot space a slice a frame; `survivors` is the
 *  probe over the compaction's lists
 *  (`../../webgpu/extinction/refill/README.md` § The survivor-driven probe). */
export type ExtinctionRefillMode = 'sliced' | 'survivors';

/** see ../../webgpu/extinction/refill/README.md § Only what is in frame */
export interface ExtinctionView {
  camera: THREE.Camera;
  worldOffset: THREE.Vector3;
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
  /** Re-pack the position table off `catalog.positions` and invalidate.
   *  Called from the epoch advance, which rewrote that array in place. */
  refreshPositions(): void;
  /** Dev-console A/B switch: false parks the star vertex stage on the
   *  in-vertex raymarch fallback and pauses cache maintenance, so the
   *  fallback side of the comparison never pays fill cost. */
  setEnabled(on: boolean): void;
  /** Whether the star vertex stage is consuming the cache this frame. */
  isActive(): boolean;
  /** Per-frame hook, taking the camera's absolute (heliocentric ICRS)
   *  position before the main render. Refills when dirty or the camera moved
   *  beyond RECOMPUTE_EPSILON_PC, and on WebGPU when the view turned as well
   *  — `view` is read there only, and a turn is an ordinary refill request
   *  (`../../webgpu/extinction/refill/README.md` § A view change is a refill
   *  request). Free only with the camera parked and the view still. */
  update(absCamX: number, absCamY: number, absCamZ: number, view?: ExtinctionView): void;
  /** Raw physical A_V for one star, out of the very texel the star vertex
   *  stage fetches. Null when the cache is inert, and on WebGPU also
   *  until `warmAvReadback` has landed the table
   *  (`../../webgpu/extinction/README.md` § Cold reads). On WebGL2 the
   *  read is a synchronous `readPixels`, so it is event-rate only: never
   *  sweep it over the catalog there. */
  readAvMag(idx: number): number | null;
  /** WebGPU only: a pick is imminent, so stage the whole A_V table onto
   *  the CPU before anything asks for it. One mapped copy of the buffer,
   *  at most one per recompute and none while the camera is under way,
   *  and the pointer dwell covers its latency — which is what lets
   *  `readAvMag` answer the first pick exactly rather than a jiggle
   *  later. Reads are synchronous on WebGL2, so there is nothing to
   *  warm. */
  warmAvReadback?(): void;
  /** WebGPU only: march every star once more as a fragment pass and
   *  bit-compare against the compute kernel's buffer. Null while the cache
   *  is inert. Dev-console only — it reads the whole buffer back. */
  verifyParity?(): Promise<AvParityReport | null>;
  dispose(): void;
}
