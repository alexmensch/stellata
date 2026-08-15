// Pure statistics for the frame-cost harness: dwell summaries and
// baseline-vs-disabled differential rows. See README.md § Frame pricing.

export interface DwellStats {
  readonly samples: number;
  readonly medianMs: number;
  readonly iqrMs: number;
}

export interface PriceFrameRow {
  readonly pass: string;
  readonly method: 'timer-query' | 'raf-delta';
  readonly baselineMs: number;
  readonly disabledMs: number;
  readonly savedMs: number;
  readonly savedPct: number;
  readonly samples: number;
  readonly iqrMs: number;
  readonly noiseMs: number;
}

/** IQR → σ for a normal sample; the divisor is 2·Φ⁻¹(0.75). */
const IQR_TO_SIGMA = 1 / 1.349;
/** SE of a median is this multiple of the SE of a mean, asymptotically. */
const MEDIAN_SE_FACTOR = 1.2533;

function sortedCopy(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

export function median(xs: readonly number[]): number {
  const sorted = sortedCopy(xs);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank, so every returned value is an observed sample. */
export function percentile(xs: readonly number[], p: number): number {
  const sorted = sortedCopy(xs);
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export function summarizeDwell(samples: readonly number[]): DwellStats | null {
  if (samples.length === 0) return null;
  return {
    samples: samples.length,
    medianMs: median(samples),
    iqrMs: percentile(samples, 0.75) - percentile(samples, 0.25),
  };
}

/**
 * How far from zero a differential has to sit before it means anything
 * WITHIN one run: the combined standard error of the two medians, from a
 * robust σ so one hitched frame cannot inflate it.
 *
 * A dwell's max−min cannot do this job — over 120 frames it is set by a
 * single outlier and reads tens of times the actual uncertainty, which
 * gates out every true row. Thermal drift across a whole sweep is NOT in
 * here; the authoritative floor is the run-to-run range from
 * `priceFrameRepeat` together with the end-of-run baseline drift.
 */
export function differentialNoiseMs(a: DwellStats, b: DwellStats): number {
  return Math.hypot(medianStandardError(a), medianStandardError(b));
}

function medianStandardError(stats: DwellStats): number {
  if (stats.samples <= 0) return 0;
  return (MEDIAN_SE_FACTOR * stats.iqrMs * IQR_TO_SIGMA) / Math.sqrt(stats.samples);
}

/** One table row: what disabling `pass` saved against the baseline dwell. */
export function buildPriceRow(
  pass: string,
  method: PriceFrameRow['method'],
  baseline: DwellStats,
  disabled: DwellStats,
): PriceFrameRow {
  const savedMs = baseline.medianMs - disabled.medianMs;
  return {
    pass,
    method,
    baselineMs: round3(baseline.medianMs),
    disabledMs: round3(disabled.medianMs),
    savedMs: round3(savedMs),
    savedPct: baseline.medianMs > 0 ? round1((savedMs / baseline.medianMs) * 100) : 0,
    samples: Math.min(baseline.samples, disabled.samples),
    iqrMs: round3(Math.max(baseline.iqrMs, disabled.iqrMs)),
    noiseMs: round3(differentialNoiseMs(baseline, disabled)),
  };
}

function round3(x: number): number {
  return Number(x.toFixed(3));
}

function round1(x: number): number {
  return Number(x.toFixed(1));
}
