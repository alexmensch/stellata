// Async half of the dual-boot seam: construct + init the WebGPURenderer
// and the seam handle. Loaded via import() from main.ts — the module (and
// three/webgpu with it) never reaches the WebGL2 bundle.

import { Scene, WebGPURenderer } from 'three/webgpu';
import type { SharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes, type SharedUniformNodeRegistry } from './shared-uniform-nodes';
import type { WebGpuSeam } from './seam';

/** Null when WebGPU is unavailable or init fails — the caller falls back
 *  to the shipped WebGL2 boot rather than showing a broken canvas. */
export async function bootWebGpu(canvas: HTMLCanvasElement): Promise<WebGpuSeam | null> {
  if (!('gpu' in navigator)) return null;
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true,
    trackTimestamp: true,
  });
  try {
    await renderer.init();
  } catch (err) {
    console.warn('WebGPU init failed; falling back to WebGL2:', err);
    renderer.dispose();
    return null;
  }
  let registry: SharedUniformNodeRegistry | null = null;
  return {
    renderer,
    scene: new Scene(),
    get uniformNodes() { return registry?.nodes ?? null; },
    bindSharedUniforms(shared: SharedUniforms) {
      registry = buildSharedUniformNodes(shared);
    },
    syncUniformNodes() {
      registry?.sync();
    },
  };
}
