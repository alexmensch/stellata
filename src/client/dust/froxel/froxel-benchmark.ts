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
  /** Frustum aspect the grid is sized for, defaulting to the 16:9 the cost
   *  table is written at. Pass `stellata.camera.aspect` to price the window
   *  you are actually looking at instead. */
  aspect?: number;
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
  readonly aspect: number;
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
  /** The aspect the cost table is written at. The grid is sized from the
   *  frustum, so a reading taken at the window's own shape is comparable only
   *  to that window — pin it or the numbers do not transfer. */
  aspect: 16 / 9,
} as const;

/** A query resolves a frame or two after submission; anything slower than
 *  this many frames means the slot is held elsewhere (an open perf panel). */
const RESULT_TIMEOUT_FRAMES = 120;

/** Fence-path bounds. The batch grows until it spans MIN_FENCE_BATCH_MS so the
 *  rAF poll's ~16.7 ms quantum is a small share of the difference. */
const FENCE_TIMEOUT_FRAMES = 240;
const MIN_FENCE_BATCH_MS = 150;
const MAX_FENCE_BATCH = 256;

/** Whole-sweep ceiling. A benchmark that cannot finish has to hand the tab
 *  back with the FOV and pixel ratio restored, not sit on them. */
const SWEEP_BUDGET_MS = 90_000;

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

/**
 * Wall time from submitting `fills` fills to the GPU signalling it finished.
 *
 * **The poll must yield.** WebGL2 pins `clientWaitSync`'s timeout at 0, so
 * the only wait available is a poll — and spinning on it from the main thread
 * deadlocks the tab: the fence's completion is delivered through the same
 * event loop the spin is starving. Poll across rAF instead, which is why the
 * result is quantised to the frame period and why only the slope below is
 * usable.
 */
async function fenceElapsedMs(
  gl: WebGL2RenderingContext,
  fills: number,
  runFill: () => void,
): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < fills; i++) runFill();
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) return NaN;
  gl.flush();
  for (let f = 0; f < FENCE_TIMEOUT_FRAMES; f++) {
    if (gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED) break;
    await nextFrame();
  }
  gl.deleteSync(fence);
  return performance.now() - started;
}

/**
 * Per-fill cost from the difference between a 2N-fill batch and an N-fill
 * one. Submission cost, fence latency and the rAF poll's granularity are all
 * constant in N and cancel; the absolute times are unusable on their own.
 *
 * This is wall time inside a live render loop, not GPU execution time — the
 * app keeps drawing between polls and the fills queue behind it. It answers
 * "what does adding this pass cost", which is the decision, but it must never
 * be set beside a timer-query figure.
 */
async function timeBatchByFence(
  gl: WebGL2RenderingContext,
  fills: number,
  runFill: () => void,
): Promise<number | null> {
  const single = await fenceElapsedMs(gl, fills, runFill);
  const double = await fenceElapsedMs(gl, fills * 2, runFill);
  if (Number.isNaN(single) || Number.isNaN(double)) return null;
  const slope = (double - single) / fills;
  return slope > 0 ? slope : null;
}

/** Grow the batch until it spans enough frames that the rAF poll's quantum is
 *  a small share of it — without which the slope is mostly frame-period noise. */
async function calibrateBatch(
  gl: WebGL2RenderingContext,
  start: number,
  runFill: () => void,
): Promise<number> {
  let fills = start;
  while (fills < MAX_FENCE_BATCH) {
    if (await fenceElapsedMs(gl, fills, runFill) >= MIN_FENCE_BATCH_MS) break;
    fills *= 2;
  }
  return fills;
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
  const aspect = options.aspect ?? DEFAULTS.aspect;
  const deadline = performance.now() + SWEEP_BUDGET_MS;

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
  spike.setAspectOverride(aspect);

  const rows: FroxelBenchmarkRow[] = [];
  try {
    for (const pixelRatio of pixelRatios) {
      stellata.renderer.setPixelRatio(pixelRatio);
      window.dispatchEvent(new Event('resize'));
      for (const fovDeg of fovs) {
        if (performance.now() > deadline) {
          console.warn('froxel bench: out of budget, sweep truncated');
          break;
        }
        stellata.setCameraFov(fovDeg);
        await nextFrame();
        const abs = stellata.absCameraPosition(new THREE.Vector3());
        const runFill = () => spike.renderFill(camera, abs);
        runFill(); // warm the target allocation + shader compile out of the timings

        const batchFills = ext === null
          ? await calibrateBatch(gl, fillsPerBatch, runFill)
          : fillsPerBatch;
        const samples: number[] = [];
        for (let b = 0; b < batches && performance.now() < deadline; b++) {
          const ms = ext === null
            ? await timeBatchByFence(gl, batchFills, runFill)
            : await timeBatch(gl, ext, batchFills, runFill);
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
          aspect: Number(aspect.toFixed(3)),
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
    spike.setAspectOverride(null);
    spike.setEnabled(wasEnabled);
    stellata.renderer.setPixelRatio(restoreRatio);
    window.dispatchEvent(new Event('resize'));
    stellata.setCameraFov(restoreFov);
  }

  console.table(rows);
  return rows;
}
