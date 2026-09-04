// Statistics for one dwell of frame times: the percentiles, and whether
// the numbers are the compositor's cadence rather than frame cost.
// README.md § Dwell mode.

import {
  interquartileRange,
  lag1Autocorrelation,
  percentile,
} from '../../src/client/debug/frame-cost/frame-cost-pure';

export const DEFAULT_DWELL_FRAMES = 240;

/** The clamp tolerance as a fraction of the measured idle interval: 1 ms on
 *  a 60 Hz panel, 0.5 ms at 120 Hz. A fixed millisecond would sit within
 *  reach of some multiple of a small interval whatever the frame cost. */
export const VSYNC_CLAMP_TOLERANCE = 0.06;

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
  return {
    samples: samples.length,
    p50,
    p90: percentile(samples, 0.9),
    p99: percentile(samples, 0.99),
    iqrMs,
    lag1: lag1Autocorrelation(samples),
    vsyncClamped: isVsyncClamped(p50, iqrMs, cadenceMs),
  };
}
