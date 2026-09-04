// Statistics for one dwell of frame times: the percentiles, and whether
// the numbers are the compositor's cadence rather than frame cost.
// README.md § Dwell mode.

import {
  interquartileRange,
  lag1Autocorrelation,
  percentile,
} from '../../src/client/debug/frame-cost/frame-cost-pure';

export const DEFAULT_DWELL_FRAMES = 240;

/** How tightly a dwell has to sit before its p50 can be read as a cadence
 *  rather than a cost, and how far off that cadence it may still land. A
 *  frame whose spread is wider than this is doing real and varying work. */
export const VSYNC_CLAMP_IQR_MS = 1;

/**
 * A dwell measured the display, not the frame, when it sat at the cadence
 * the runner measured with the gate idle and barely moved: the frame
 * finished early and the compositor supplied the rest of the period. Such a
 * dwell is refused by `--baseline` and makes a sweep inconclusive.
 *
 * The cadence is measured per scenario rather than assumed, because the
 * period that matters is the display's: 16.67 ms on a 60 Hz panel, 8.33 on
 * a 120 Hz one, and on an unthrottled headless display no period at all —
 * where a fixed 60 Hz ceiling would throw away every genuinely fast frame
 * as though a compositor it does not have had padded it.
 *
 * `null` means the samples are not wall clock — a GPU duration is a span
 * the hardware reports, and nothing holds it to a display period.
 */
export function isVsyncClamped(p50: number, iqrMs: number, cadenceMs: number | null): boolean {
  if (cadenceMs === null || !(cadenceMs > 0)) return false;
  return iqrMs < VSYNC_CLAMP_IQR_MS && p50 <= cadenceMs + VSYNC_CLAMP_IQR_MS;
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
