// Console-driven GPU timing for the froxel fill: batches of fills under one
// EXT_disjoint_timer_query_webgl2 scope, swept over FOV and pixel ratio.
// See ./README.md § Running the benchmark.

import * as THREE from 'three';
import type { Stellata } from '../../stellata';
import type { FroxelFillSpike } from './froxel-fill-spike';

interface DisjointTimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface FroxelBenchmarkOptions {
  /** Vertical FOVs to sweep, degrees. The default is the shipped default and
   *  the 120° corner the design gate asks to be priced. */
  fovs?: readonly number[];
  pixelRatios?: readonly number[];
  /** Fills per timed batch. One query brackets the whole batch, so query
   *  overhead and pass-boundary effects divide away. */
  fillsPerBatch?: number;
  batches?: number;
}

/** Which clock produced `msPerFill`. The two are NOT comparable: a timer
 *  query measures GPU execution, the fence delta measures wall time to
 *  completion with constant overhead differenced out. Record the method
 *  alongside any number that leaves this console. */
export type FroxelTimingMethod = 'timer-query' | 'fence-delta';

export interface FroxelBenchmarkRow {
  readonly fovDeg: number;
  readonly pixelRatio: number;
  readonly method: FroxelTimingMethod;
  readonly cells: string;
  readonly mib: number;
  readonly fetchesM: number;
  readonly msPerFill: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly gFetchPerSec: number;
}

const DEFAULTS = {
  fovs: [50, 120],
  pixelRatios: [1, 2],
  fillsPerBatch: 8,
  batches: 5,
} as const;

/** A query resolves a frame or two after submission; anything slower than
 *  this many frames means the slot is held elsewhere (an open perf panel). */
const RESULT_TIMEOUT_FRAMES = 120;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Time one batch of `fills` back-to-back fills. The batch is the whole of the
 * GL work between the query's begin and end, so a tile-based driver cannot
 * attribute another pass's fragments to it — the over-attribution that makes
 * the perf HUD's per-pass scopes a relative signal only.
 */
async function timeBatch(
  gl: WebGL2RenderingContext,
  ext: DisjointTimerExt,
  fills: number,
  runFill: () => void,
): Promise<number | null> {
  const query = gl.createQuery();
  if (query === null) return null;
  gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
  for (let i = 0; i < fills; i++) runFill();
  gl.endQuery(ext.TIME_ELAPSED_EXT);

  for (let frame = 0; frame < RESULT_TIMEOUT_FRAMES; frame++) {
    await nextFrame();
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
    gl.deleteQuery(query);
    return disjoint ? null : ns / 1e6 / fills;
  }
  gl.deleteQuery(query);
  return null;
}

/** Wall time from submitting `fills` fills to the GPU signalling it finished
 *  them. WebGL2 pins `clientWaitSync`'s timeout at 0, so the wait is a spin —
 *  acceptable in a benchmark, and the only clock Safari offers. */
function fenceElapsedMs(gl: WebGL2RenderingContext, fills: number, runFill: () => void): number {
  const started = performance.now();
  for (let i = 0; i < fills; i++) runFill();
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) return NaN;
  while (gl.clientWaitSync(fence, gl.SYNC_FLUSH_COMMANDS_BIT, 0) === gl.TIMEOUT_EXPIRED) {
    if (performance.now() - started > 5000) break;
  }
  gl.deleteSync(fence);
  return performance.now() - started;
}

/**
 * Per-fill cost from the difference between a 2N-fill batch and an N-fill
 * one, which cancels submission, fence latency and the spin's own granularity
 * exactly — none of them scale with N. The absolute times are unusable on
 * their own; the slope is the measurement.
 *
 * Safari exposes no timer query at all, and it is also the interesting
 * platform: it drives Metal directly where Chrome goes through ANGLE, so the
 * number here can be the faster one even though the clock is cruder.
 */
function timeBatchByFence(
  gl: WebGL2RenderingContext,
  fills: number,
  runFill: () => void,
): number | null {
  const single = fenceElapsedMs(gl, fills, runFill);
  const double = fenceElapsedMs(gl, fills * 2, runFill);
  if (Number.isNaN(single) || Number.isNaN(double)) return null;
  const slope = (double - single) / fills;
  return slope > 0 ? slope : null;
}

/**
 * Sweep the fill over FOV and pixel ratio and return one row per cell of the
 * matrix. Leaves the camera pose alone — fly where the measurement wants
 * (Sol, 3 kpc out) and run it there.
 */
export async function runFroxelBenchmark(
  stellata: Stellata,
  spike: FroxelFillSpike,
  options: FroxelBenchmarkOptions = {},
): Promise<FroxelBenchmarkRow[]> {
  const fovs = options.fovs ?? DEFAULTS.fovs;
  const pixelRatios = options.pixelRatios ?? DEFAULTS.pixelRatios;
  const fillsPerBatch = options.fillsPerBatch ?? DEFAULTS.fillsPerBatch;
  const batches = options.batches ?? DEFAULTS.batches;

  const gl = stellata.renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerExt | null;
  const method: FroxelTimingMethod = ext === null ? 'fence-delta' : 'timer-query';
  if (ext === null) {
    console.info(
      'froxel bench: no timer query on this context (Safari exposes none) — ' +
      'falling back to the fence-delta clock. Do not compare its numbers against ' +
      'a timer-query run.',
    );
  }

  const camera = stellata.camera as THREE.PerspectiveCamera;
  const restoreFov = camera.fov;
  const restoreRatio = stellata.renderer.getPixelRatio();
  const wasEnabled = spike.isEnabled();
  spike.setEnabled(true);

  const rows: FroxelBenchmarkRow[] = [];
  try {
    for (const pixelRatio of pixelRatios) {
      stellata.renderer.setPixelRatio(pixelRatio);
      window.dispatchEvent(new Event('resize'));
      for (const fovDeg of fovs) {
        stellata.setCameraFov(fovDeg);
        await nextFrame();
        const abs = stellata.absCameraPosition(new THREE.Vector3());
        const runFill = () => spike.renderFill(camera, abs);
        runFill(); // warm the target allocation + shader compile out of the timings

        const samples: number[] = [];
        for (let b = 0; b < batches; b++) {
          const ms = ext === null
            ? timeBatchByFence(gl, fillsPerBatch, runFill)
            : await timeBatch(gl, ext, fillsPerBatch, runFill);
          if (ms !== null) samples.push(ms);
          await nextFrame();
        }
        if (samples.length === 0) {
          console.warn(
            `froxel bench: no timings at ${fovDeg}° — ` +
            (ext === null
              ? 'the fence never signalled'
              : 'close the debug panel; its perf timer holds the context\'s single query slot'),
          );
          continue;
        }
        const s = spike.stats(camera, abs);
        const msPerFill = median(samples);
        rows.push({
          fovDeg,
          pixelRatio,
          method,
          cells: `${s.cellsX}x${s.cellsY}`,
          mib: Number(s.mib.toFixed(1)),
          fetchesM: Number((s.predictedFetches / 1e6).toFixed(1)),
          msPerFill: Number(msPerFill.toFixed(3)),
          minMs: Number(Math.min(...samples).toFixed(3)),
          maxMs: Number(Math.max(...samples).toFixed(3)),
          gFetchPerSec: Number((s.predictedFetches / msPerFill / 1e6).toFixed(1)),
        });
      }
    }
  } finally {
    spike.setEnabled(wasEnabled);
    stellata.renderer.setPixelRatio(restoreRatio);
    window.dispatchEvent(new Event('resize'));
    stellata.setCameraFov(restoreFov);
  }

  console.table(rows);
  return rows;
}
