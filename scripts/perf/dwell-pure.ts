// Statistics for one dwell of frame times: the percentiles, and whether
// the numbers are the compositor's cadence rather than frame cost.
// README.md § Dwell mode.

import {
  CADENCE_TOLERANCE,
  interquartileRange,
  lag1Autocorrelation,
  median,
  percentile,
} from '../../src/client/debug/frame-cost/frame-cost-pure';

export const DEFAULT_DWELL_FRAMES = 240;

/** A dwell is read in this many consecutive slices; their medians spanning
 *  more than `STATE_GUARD_TREND_MS` is the machine changing state under the
 *  dwell (the sustained-load GPU power step), and such a row compares with
 *  nothing — README.md § Dwell mode. */
export const STATE_GUARD_QUARTERS = 4;
export const STATE_GUARD_TREND_MS = 1;

export type StateGuard = 'steady' | 'trending';

export function quarterMedians(
  samples: readonly number[],
  quarters: number = STATE_GUARD_QUARTERS,
): number[] {
  if (samples.length < quarters) return [];
  const size = samples.length / quarters;
  return Array.from({ length: quarters }, (_, i) =>
    median(samples.slice(Math.floor(i * size), Math.floor((i + 1) * size))));
}

/**
 * The spread of the quarter medians, not a monotonic run through them: the
 * power step is a step, so it lands as `[16.9, 16.9, 21.8, 21.8]` — flat,
 * then flat higher — which no strictly-rising test sees. Spread also catches
 * a dwell that was merely unstable, which a pin should decline for the same
 * reason.
 */
export function stateGuardVerdict(
  quarters: readonly number[],
  trendMs: number = STATE_GUARD_TREND_MS,
): StateGuard {
  if (quarters.length < 2) return 'steady';
  return Math.max(...quarters) - Math.min(...quarters) > trendMs ? 'trending' : 'steady';
}

/** The clamp tolerance as a fraction of the measured idle interval: 1 ms on
 *  a 60 Hz panel, 0.5 ms at 120 Hz. A fixed millisecond would sit within
 *  reach of some multiple of a small interval whatever the frame cost. The
 *  differential's under-cadence rule shares the number. */
export const VSYNC_CLAMP_TOLERANCE = CADENCE_TOLERANCE;

export function vsyncClampToleranceMs(cadenceMs: number): number {
  return cadenceMs * VSYNC_CLAMP_TOLERANCE;
}

/**
 * A dwell measured the display, not the frame, when it barely moved and its
 * p50 sits on a whole number of the idle interval the runner measured for
 * this scenario: the frame finished early and the compositor held it to the
 * next refresh. Any whole number, because a frame that overran one interval
 * is held to the one after — 12 ms of work on a 120 Hz panel reads 16.67,
 * still the display's number. Such a dwell is refused by `--baseline` and
 * makes a sweep inconclusive.
 *
 * `null` means the samples are not wall clock — a GPU duration is a span
 * the hardware reports, and nothing holds it to a display period.
 */
export function isVsyncClamped(p50: number, iqrMs: number, cadenceMs: number | null): boolean {
  if (cadenceMs === null || !(cadenceMs > 0)) return false;
  const toleranceMs = vsyncClampToleranceMs(cadenceMs);
  if (iqrMs >= toleranceMs) return false;
  const intervals = Math.max(1, Math.round(p50 / cadenceMs));
  return Math.abs(p50 - intervals * cadenceMs) <= toleranceMs;
}

export interface DwellSummary {
  readonly samples: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly iqrMs: number;
  /** Serial structure: negative alternation, ~0 independent scatter,
   *  positive drift inside the dwell. */
  readonly lag1: number;
  readonly vsyncClamped: boolean;
  /** Medians of the dwell's consecutive quarters, in time order. */
  readonly quarterMedians: readonly number[];
  readonly stateGuard: StateGuard;
}

/**
 * Percentiles are nearest-rank, so every value reported is a frame that
 * actually happened — including p50, which therefore does not interpolate
 * between the two middle frames of an even-length dwell.
 *
 * `cadenceMs` is the idle rAF period measured for this scenario, or null for
 * samples that are not wall clock (`isVsyncClamped`).
 */
export function summarizeFrameDwell(
  samples: readonly number[],
  cadenceMs: number | null,
): DwellSummary | null {
  if (samples.length === 0) return null;
  const p50 = percentile(samples, 0.5);
  const iqrMs = interquartileRange(samples);
  const quarters = quarterMedians(samples);
  return {
    samples: samples.length,
    p50,
    p90: percentile(samples, 0.9),
    p99: percentile(samples, 0.99),
    iqrMs,
    lag1: lag1Autocorrelation(samples),
    vsyncClamped: isVsyncClamped(p50, iqrMs, cadenceMs),
    quarterMedians: quarters,
    stateGuard: stateGuardVerdict(quarters),
  };
}

/** What a WebGPU dwell counts per frame on the API surface: queue submits,
 *  the command buffers those carried, and the render / compute passes
 *  encoded. README.md § Dwell mode. */
export const PASS_COUNTERS = ['submits', 'commandBuffers', 'renderPasses', 'computePasses'] as const;
export type PassCounter = (typeof PASS_COUNTERS)[number];
export type PassCountsPerFrame = Readonly<Record<PassCounter, readonly number[]>>;

export interface CountSummary {
  readonly min: number;
  readonly p50: number;
  readonly max: number;
}

export type PassCountsSummary = Readonly<Record<PassCounter, CountSummary>>;

/** Nearest-rank p50 with the extremes: a per-frame count is small and
 *  quantised, so the spread matters more than any percentile between. */
export function summarizePassCounts(perFrame: PassCountsPerFrame): PassCountsSummary | null {
  if (perFrame.submits.length === 0) return null;
  const summary = {} as Record<PassCounter, CountSummary>;
  for (const counter of PASS_COUNTERS) {
    const xs = perFrame[counter];
    summary[counter] = { min: Math.min(...xs), p50: percentile(xs, 0.5), max: Math.max(...xs) };
  }
  return summary;
}
