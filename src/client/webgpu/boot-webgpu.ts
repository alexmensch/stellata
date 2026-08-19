// Async half of the dual-boot seam: construct + init the WebGPURenderer
// and the seam handle. Loaded via import() from main.ts — the module (and
// three/webgpu with it) never reaches the WebGL2 bundle.

import { LinearSRGBColorSpace, Scene, WebGPURenderer } from 'three/webgpu';
import type { SharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes, type SharedUniformNodeRegistry } from './shared-uniform-nodes';
import type { StarGeometrySources, WebGpuSeam } from './seam';
import { StarLayer } from './star/star-layer';

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
    // The reason only; the caller owns the fallback decision and says so.
    console.warn('WebGPURenderer.init() rejected:', err);
    renderer.dispose();
    return null;
  }
  // Output stays in the working colour space: ported shaders own the
  // whole transfer chain (operator + sRGB encode), exactly as the GLSL
  // build's do, and any other setting makes three render the scene into
  // a hidden full-resolution target plus a colour-transform pass —
  // double-encoding every emitter and pricing an extra fullscreen pass
  // into every frame (README.md § Output colour space).
  renderer.outputColorSpace = LinearSRGBColorSpace;
  let registry: SharedUniformNodeRegistry | null = null;
  const scene = new Scene();
  return {
    renderer,
    scene,
    timestampsAvailable: renderer.hasFeature('timestamp-query'),
    get uniformNodes() { return registry?.nodes ?? null; },
    bindSharedUniforms(shared: SharedUniforms) {
      registry = buildSharedUniformNodes(shared);
    },
    syncUniformNodes() {
      registry?.sync();
    },
    attachStarLayer(sources: StarGeometrySources) {
      if (registry === null) {
        throw new Error('attachStarLayer before bindSharedUniforms');
      }
      return new StarLayer(scene, registry.nodes, sources);
    },
  };
}
