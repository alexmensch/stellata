// What each mode does to a page that has already booted and settled. The
// browser and scenario lifecycle is run.ts; every page.evaluate is
// page-protocol.ts. README.md § What a run does.

import type { Page } from 'playwright';
import type { GpuFrameMethod } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { summarizeFrameDwell } from './dwell-pure';
import {
  awaitSettle,
  readDrawingBuffer,
  readGateSnapshot,
  runDwell,
  type DwellRaw,
} from './page-protocol';
import type { Backend } from './scenarios';
import type { DwellRecord, SweepRecord } from './schema';
import { fitLogLog, sweepBracketMs, sweepOrder, type SweepPoint } from './sweep-pure';

/** The dev server's own module URL for the WebGPU sample stream. It has no
 *  window surface, so a dwell reaches it through the module graph. */
export const GPU_SAMPLES_MODULE_URL = '/src/client/debug/gpu-timing/gpu-frame-samples.ts';

/**
 * Frames discarded after a resize, before the sweep's next dwell. Shorter
 * than a cold warmup on purpose: the resize has to be absorbed (the HDR
 * target and its attachments are rebuilt at the new size) but the clock
 * ramp the long warmup exists for was already paid by the sweep's first
 * point, and re-paying it per scale would triple a five-point sweep.
 */
export const SWEEP_RESIZE_WARMUP_FRAMES = 60;

export interface Measured<T> {
  readonly value: T | null;
  readonly failure: string | null;
}

export interface DwellPlan {
  readonly frames: number;
  readonly warmupFrames: number;
  readonly backend: Backend;
}

/** rAF wall-clock deltas, whatever else was subscribed alongside. The GPU
 *  stream is a second opinion on the same frames, never the row's clock. */
export const DWELL_METHOD: GpuFrameMethod = 'raf-delta';

function toRecord(raw: DwellRaw): DwellRecord | null {
  const stats = summarizeFrameDwell(raw.deltasMs);
  if (stats === null) return null;
  return {
    deltasMs: raw.deltasMs,
    gpuMs: raw.gpuMs.length > 0 ? raw.gpuMs : null,
    gpuNote: raw.gpuNote,
    stats,
    gpuStats: summarizeFrameDwell(raw.gpuMs),
    limitMag: raw.effectiveLimitMag,
    dm: raw.dm,
    readbackPerFrame: raw.readbackPerFrame,
  };
}

/**
 * One dwell, plus the check that it put the page back. A dwell holds the
 * render gate and stops the simulation clock; leaking either would make
 * every later scenario in the run measure a different machine, so the
 * leak fails this scenario rather than being reported as a note.
 */
export async function measureDwell(page: Page, plan: DwellPlan): Promise<Measured<DwellRecord>> {
  const raw = await runDwell(page, {
    frames: plan.frames,
    warmupFrames: plan.warmupFrames,
    wantGpuStream: plan.backend === 'webgpu',
    samplesModuleUrl: GPU_SAMPLES_MODULE_URL,
  });
  const record = toRecord(raw);
  if (record === null) {
    return { value: null, failure: `no rAF deltas over ${plan.frames} frames` };
  }
  if (raw.rateAfter !== raw.rateBefore) {
    return {
      value: record,
      failure: `the dwell left the clock at ${raw.rateAfter}x, not the ${raw.rateBefore}x it found`,
    };
  }
  const snap = await readGateSnapshot(page);
  if (snap.holds !== 0) {
    return {
      value: record,
      failure: `the dwell leaked ${snap.holds} render-gate hold(s)`,
    };
  }
  return { value: record, failure: null };
}

export interface SweepPlan extends DwellPlan {
  readonly scales: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly quietMs: number;
  readonly settleTimeoutMs: number;
}

/**
 * Dwell at each viewport scale in turn and fit the exponent relating frame
 * time to backing-store pixels. Scale 1 is measured first and last
 * (`sweepOrder`), and the spread of those two is the floor any slope claim
 * sits on: an instrument that drifted across the sweep produces a
 * dependence on elapsed time that looks like a dependence on area.
 *
 * The viewport moves; the device pixel ratio does not. Changing both at
 * once would confound area with the per-pixel work dpr also scales.
 */
export async function measureSweep(page: Page, plan: SweepPlan): Promise<Measured<SweepRecord>> {
  const points: SweepPoint[] = [];
  for (const [i, scale] of sweepOrder(plan.scales).entries()) {
    const width = Math.round(plan.width * scale);
    const height = Math.round(plan.height * scale);
    await page.setViewportSize({ width, height });
    await awaitSettle(page, { quietMs: plan.quietMs, timeoutMs: plan.settleTimeoutMs });
    const dwelt = await measureDwell(page, {
      ...plan,
      warmupFrames: i === 0 ? plan.warmupFrames : SWEEP_RESIZE_WARMUP_FRAMES,
    });
    if (dwelt.failure !== null) return { value: null, failure: `scale ${scale}: ${dwelt.failure}` };
    if (dwelt.value === null) return { value: null, failure: `scale ${scale}: no samples` };
    const buffer = await readDrawingBuffer(page);
    points.push({
      scale,
      width,
      height,
      px: buffer.width * buffer.height,
      ms: dwelt.value.stats.p50,
      vsyncClamped: dwelt.value.stats.vsyncClamped,
    });
  }
  return {
    value: { points, fit: fitLogLog(points), bracketMs: sweepBracketMs(points) },
    failure: null,
  };
}
