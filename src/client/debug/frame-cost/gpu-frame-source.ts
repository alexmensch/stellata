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
}

/**
 * Null when the sweep cannot proceed; the caller has already been told why
 * on the console. `raf-delta` comes back with a no-op release — that
 * method has no sample source at all and the caller times frames itself.
 */
export function acquireGpuFrameSource(
  host: GpuFrameSourceHost,
  onSample: (ms: number) => void,
): GpuFrameSource | null {
  if (host.rendererGL === null) {
    // The WebGPU render loop resolves its timestamps on every rendered
    // frame whether or not anyone is listening, so the harness only has to
    // subscribe. Nothing is exclusive here: the debug panel may stay open,
    // and the WebGL2 closed-panel precondition has no counterpart.
    return { method: 'timestamp', release: onGpuFrameSample(onSample) };
  }
  const gl = host.rendererGL.getContext() as WebGL2RenderingContext;
  if (gl.getExtension('EXT_disjoint_timer_query_webgl2') === null) {
    console.info(
      'priceFrame: no GPU timer query on this context (WebGL2 Safari ' +
      'exposes none) — using rAF-delta wall time. Differentials below the ' +
      'vsync quantum read as zero unless the frame is already over budget.',
    );
    return { method: 'raf-delta', release: () => {} };
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
