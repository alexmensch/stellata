// The dual-boot contract between the integration shell and the WebGPU
// boot path. Type-only — every three/webgpu VALUE import stays behind
// boot-webgpu.ts's dynamic import (see README.md § Import boundary).

import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { SharedUniforms } from '../frame/shared-uniforms';
import type { SharedUniformNodes } from './shared-uniform-nodes';

export type StellataRenderer = THREE.WebGLRenderer | WebGPURenderer;

export interface WebGpuSeam {
  readonly renderer: WebGPURenderer;
  /** Rendered in place of the shell's scene on a WebGPU boot — empty
   *  until port children add their TSL layers to it. */
  readonly scene: THREE.Scene;
  /** Built by the shell right after buildSharedUniforms; null before. */
  readonly uniformNodes: SharedUniformNodes | null;
  bindSharedUniforms(shared: SharedUniforms): void;
  /** Per-frame scalar copy from the WebGL-side map into the nodes —
   *  called from animate() before the render (README.md § Shared
   *  uniform nodes). */
  syncUniformNodes(): void;
}
