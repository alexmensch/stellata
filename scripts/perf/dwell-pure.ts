// Statistics for one dwell of frame times: the percentiles, and whether
// the numbers are the compositor's cadence rather than frame cost.
// README.md § Dwell mode.

import {
  interquartileRange,
  lag1Autocorrelation,
  percentile,
} from '../../src/client/debug/frame-cost/frame-cost-pure';

export const DEFAULT_DWELL_FRAMES = 240;

/** A p50 under this, held this tightly, is vsync rather than frame cost:
 *  the frame finished early and the compositor supplied the rest of the
 *  16.67 ms. Such a dwell measures the panel, so a slope fitted through it
 *  is inconclusive and a diff against it is meaningless. */
export const VSYNC_CLAMP_P50_MS = 17;
export const VSYNC_CLAMP_IQR_MS = 1;

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
 */
export function summarizeFrameDwell(samples: readonly number[]): DwellSummary | null {
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
    vsyncClamped: p50 < VSYNC_CLAMP_P50_MS && iqrMs < VSYNC_CLAMP_IQR_MS,
  };
}
