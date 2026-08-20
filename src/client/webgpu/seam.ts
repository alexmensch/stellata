// The dual-boot contract between the integration shell and the WebGPU
// boot path. Type-only — every three/webgpu VALUE import stays behind
// boot-webgpu.ts's dynamic import (see README.md § Import boundary).

import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { SharedUniforms } from '../frame/shared-uniforms';
import type { SharedUniformNodes } from './shared-uniform-nodes';
import type { StarGeometrySources } from './star/star-geometry';

export type StellataRenderer = THREE.WebGLRenderer | WebGPURenderer;

export type { StarGeometrySources } from './star/star-geometry';

export interface WebGpuStarLayer {
  /** The shell's per-frame CPU gate on the depth-only core-mask draw —
   *  the same `visible` flip it applies to the WebGL mesh. */
  setCoreMaskVisible(on: boolean): void;
  dispose(): void;
}

export interface WebGpuSeam {
  readonly renderer: WebGPURenderer;
  /** Rendered in place of the shell's scene on a WebGPU boot — empty
   *  until port children add their TSL layers to it. */
  readonly scene: THREE.Scene;
  /** Whether the adapter granted `timestamp-query`. `trackTimestamp: true`
   *  is a request: three clears it silently when the feature is absent, so
   *  every GPU-timing consumer must ask here rather than assume. */
  readonly timestampsAvailable: boolean;
  /** Built by the shell right after buildSharedUniforms; null before. */
  readonly uniformNodes: SharedUniformNodes | null;
  bindSharedUniforms(shared: SharedUniforms): void;
  /** Per-frame scalar copy from the WebGL-side map into the nodes —
   *  called from animate() before the render (README.md § Shared
   *  uniform nodes). */
  syncUniformNodes(): void;
  /** Build the TSL star layer into the seam's scene. Requires
   *  bindSharedUniforms to have run — the materials take their slots
   *  from the uniform-node mirror. */
  attachStarLayer(sources: StarGeometrySources): WebGpuStarLayer;
}
