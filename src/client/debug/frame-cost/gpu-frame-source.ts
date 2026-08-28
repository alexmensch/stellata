// Where a pricing sweep gets its whole-frame GPU numbers from, per
// backend. See README.md § Preconditions.

import type * as THREE from 'three';
import { acquireGpuFrameSampler, perfInstrumentationInstalled } from '../perf-hud';
import { gpuFrameSamplesAreSound, onGpuFrameSample } from '../gpu-timing/gpu-frame-samples';
import { GPU_FRAME_METHODS, type GpuFrameMethod } from './frame-cost-pure';

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

const VSYNC_CAVEAT =
  'Differentials below the vsync quantum read as zero unless the frame is ' +
  'already over budget.';

/** No sample source at all: the caller times frames itself, so the release
 *  is a no-op. */
function rafDeltaSource(lead: string): GpuFrameSource {
  console.info(`priceFrame: ${lead}. ${VSYNC_CAVEAT}`);
  if (perfInstrumentationInstalled()) {
    console.warn(
      'priceFrame: the debug panel is open and rAF deltas are wall time, so ' +
      "its per-tick ring fills and DOM writes land inside the sweep's own " +
      'samples. They largely cancel in a differential but widen the spread, ' +
      'and absolute frame times are biased outright — close it before ' +
      'recording a cross-backend table.',
    );
  }
  return { method: 'raf-delta', release: () => {} };
}

function rafDelta(reason: string): GpuFrameSource {
  return rafDeltaSource(`no GPU clock — ${reason}. Falling back to rAF-delta wall time`);
}

function refusePinned(method: GpuFrameMethod, reason: string): null {
  console.warn(
    `priceFrame: { method: '${method}' } pinned, but ${reason}. Refusing ` +
    'rather than silently switching clocks — a silent fallback rebuilds the ' +
    "mixed-method table pinning exists to prevent. 'raf-delta' is the one " +
    'method every backend can supply.',
  );
  return null;
}

/**
 * Null when the sweep cannot proceed; the caller has already been told why
 * on the console.
 *
 * `pinned` forces a method instead of taking the backend's best. A pinned
 * method the backend cannot supply refuses (null) — never falls back.
 */
export function acquireGpuFrameSource(
  host: GpuFrameSourceHost,
  onSample: (ms: number) => void,
  pinned?: GpuFrameMethod,
): GpuFrameSource | null {
  if (pinned !== undefined && !GPU_FRAME_METHODS.includes(pinned)) {
    console.warn(
      `priceFrame: { method: '${pinned}' } is not a clock — expected one of ` +
      `${GPU_FRAME_METHODS.map((m) => `'${m}'`).join(', ')}. Refusing: the ` +
      'console is untyped, so falling through to the backend preference ' +
      'order would leave a typo looking like an honoured pin and rebuild ' +
      'the mixed-method table pinning exists to prevent.',
    );
    return null;
  }
  if (pinned === 'raf-delta') {
    return rafDeltaSource(
      'method pinned to raf-delta wall time — the one clock every backend ' +
      'shares, so cross-backend tables compare',
    );
  }
  if (host.rendererGL === null) {
    if (pinned === 'timer-query') {
      return refusePinned(pinned, 'a WebGPU boot has no WebGL2 timer query');
    }
    if (host.webgpu?.timestampsAvailable !== true) {
      const reason = 'this adapter withheld the timestamp-query feature';
      if (pinned === 'timestamp') return refusePinned(pinned, reason);
      return rafDelta(reason);
    }
    if (!gpuFrameSamplesAreSound()) {
      const reason =
        'this backend granted timestamp-query but resolves durations no ' +
        'frame can have, so every sample is being dropped';
      if (pinned === 'timestamp') return refusePinned(pinned, reason);
      return rafDelta(reason);
    }
    // Nothing is exclusive here: the render loop resolves for whoever is
    // listening, so the debug panel may stay open.
    return { method: 'timestamp', release: onGpuFrameSample(onSample) };
  }
  if (pinned === 'timestamp') {
    return refusePinned(pinned, 'WebGPU timestamps do not exist on a WebGL2 boot');
  }
  const gl = host.rendererGL.getContext() as WebGL2RenderingContext;
  if (gl.getExtension('EXT_disjoint_timer_query_webgl2') === null) {
    const reason = 'WebGL2 exposes no timer query on this context (Safari)';
    if (pinned === 'timer-query') return refusePinned(pinned, reason);
    return rafDelta(reason);
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
