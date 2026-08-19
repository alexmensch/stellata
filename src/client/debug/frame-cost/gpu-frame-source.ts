// Where a pricing sweep gets its whole-frame GPU numbers from, per
// backend. See README.md § Preconditions.

import type * as THREE from 'three';
import { acquireGpuFrameSampler } from '../perf-hud';
import { onGpuFrameSample } from '../gpu-timing/gpu-frame-samples';
import type { GpuFrameMethod } from './frame-cost-pure';

export interface GpuFrameSource {
  readonly method: GpuFrameMethod;
  readonly release: () => void;
}

/** The slice of the shell this module reads — keeps the unit test off the
 *  whole integration shell. */
export interface GpuFrameSourceHost {
  readonly rendererGL: THREE.WebGLRenderer | null;
  readonly webgpu: { readonly timestampsAvailable: boolean } | null;
}

/** No sample source at all: the caller times frames itself, so the release
 *  is a no-op. */
function rafDelta(reason: string): GpuFrameSource {
  console.info(
    `priceFrame: no GPU clock — ${reason}. Falling back to rAF-delta wall ` +
    'time, where differentials below the vsync quantum read as zero unless ' +
    'the frame is already over budget.',
  );
  return { method: 'raf-delta', release: () => {} };
}

/**
 * Null when the sweep cannot proceed; the caller has already been told why
 * on the console.
 */
export function acquireGpuFrameSource(
  host: GpuFrameSourceHost,
  onSample: (ms: number) => void,
): GpuFrameSource | null {
  if (host.rendererGL === null) {
    if (host.webgpu?.timestampsAvailable !== true) {
      return rafDelta('this adapter withheld the timestamp-query feature');
    }
    // Nothing is exclusive here: the render loop resolves for whoever is
    // listening, so the debug panel may stay open.
    return { method: 'timestamp', release: onGpuFrameSample(onSample) };
  }
  const gl = host.rendererGL.getContext() as WebGL2RenderingContext;
  if (gl.getExtension('EXT_disjoint_timer_query_webgl2') === null) {
    return rafDelta('WebGL2 exposes no timer query on this context (Safari)');
  }
  const release = acquireGpuFrameSampler(gl, onSample);
  if (release === null) {
    console.warn(
      'priceFrame: close the debug panel first — its perf timer holds the ' +
      "context's single TIME_ELAPSED query slot",
    );
    return null;
  }
  return { method: 'timer-query', release };
}
