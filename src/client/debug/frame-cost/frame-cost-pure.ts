// Pure statistics for the frame-cost harness: dwell summaries and
// baseline-vs-disabled differential rows. See README.md.

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
  /** Interleaved rows only: how far the instrument moved between the two
   *  baselines bracketing this measurement. A savedMs under it is drift,
   *  whatever noiseMs says. */
  readonly bracketMs?: number;
}

export interface DwellFit {
  /** Dwell length to use for the rest of the sweep. */
  readonly frames: number;
  /** Whether that is shorter than what was asked for. */
  readonly shortened: boolean;
  /** Whether the sweep will run out of budget even at the floor. */
  readonly willTruncate: boolean;
  readonly perFrameMs: number;
  readonly neededMs: number;
}

/**
 * Size the remaining dwells to the time budget, from what the first one
 * cost. Shortening prices every pass at a noise floor the rows report;
 * truncating instead drops whichever passes sit last in the roster and
 * says so only at the ceiling.
 */
export function fitDwellFrames(params: {
  firstDwellMs: number;
  dwellFrames: number;
  settleFrames: number;
  remainingDwells: number;
  affordableMs: number;
  minDwellFrames: number;
}): DwellFit {
  const { dwellFrames, settleFrames, remainingDwells, affordableMs } = params;
  const framesPerDwell = settleFrames + dwellFrames;
  const perFrameMs = params.firstDwellMs / framesPerDwell;
  const neededMs = remainingDwells * framesPerDwell * perFrameMs;
  const unchanged = {
    frames: dwellFrames,
    shortened: false,
    willTruncate: false,
    perFrameMs,
    neededMs,
  };
  if (remainingDwells <= 0 || perFrameMs <= 0) return unchanged;
  if (neededMs <= affordableMs) return unchanged;

  const fitted = Math.floor(
    affordableMs / perFrameMs / remainingDwells - settleFrames,
  );
  if (fitted < params.minDwellFrames) {
    return {
      frames: params.minDwellFrames,
      shortened: dwellFrames > params.minDwellFrames,
      willTruncate: true,
      perFrameMs,
      neededMs,
    };
  }
  return { frames: fitted, shortened: true, willTruncate: false, perFrameMs, neededMs };
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

/** One table row: what disabling `pass` saved against a single baseline
 *  dwell measured once, at the start of the sweep. */
export function buildPriceRow(
  pass: string,
  method: PriceFrameRow['method'],
  baseline: DwellStats,
  disabled: DwellStats,
): PriceFrameRow {
  return assembleRow(pass, method, baseline.medianMs, disabled.medianMs, {
    samples: Math.min(baseline.samples, disabled.samples),
    iqrMs: Math.max(baseline.iqrMs, disabled.iqrMs),
    noiseMs: differentialNoiseMs(baseline, disabled),
  });
}

/**
 * One table row from a bracketed measurement: the disabled dwell sits
 * between two baseline dwells and is differenced against their mean.
 *
 * A single leading baseline is only valid on a stationary instrument.
 * This one is not — a GPU ramping its clocks under sustained load walks
 * the frame time tens of percent over a sweep, which a lone baseline
 * then charges to whichever passes happened to be measured late.
 * Bracketing cancels drift that is linear across the pair.
 */
export function buildInterleavedRow(
  pass: string,
  method: PriceFrameRow['method'],
  before: DwellStats,
  after: DwellStats,
  disabled: DwellStats,
): PriceFrameRow {
  const referenceMs = (before.medianMs + after.medianMs) / 2;
  const referenceSe =
    Math.hypot(medianStandardError(before), medianStandardError(after)) / 2;
  return assembleRow(pass, method, referenceMs, disabled.medianMs, {
    samples: Math.min(before.samples, after.samples, disabled.samples),
    iqrMs: Math.max(before.iqrMs, after.iqrMs, disabled.iqrMs),
    noiseMs: Math.hypot(referenceSe, medianStandardError(disabled)),
    bracketMs: Math.abs(after.medianMs - before.medianMs),
  });
}

function assembleRow(
  pass: string,
  method: PriceFrameRow['method'],
  referenceMs: number,
  disabledMs: number,
  stats: {
    samples: number;
    iqrMs: number;
    noiseMs: number;
    bracketMs?: number;
  },
): PriceFrameRow {
  const savedMs = referenceMs - disabledMs;
  return {
    pass,
    method,
    baselineMs: round3(referenceMs),
    disabledMs: round3(disabledMs),
    savedMs: round3(savedMs),
    savedPct: referenceMs > 0 ? round1((savedMs / referenceMs) * 100) : 0,
    samples: stats.samples,
    iqrMs: round3(stats.iqrMs),
    noiseMs: round3(stats.noiseMs),
    ...(stats.bracketMs === undefined ? {} : { bracketMs: round3(stats.bracketMs) }),
  };
}

function round3(x: number): number {
  return Number(x.toFixed(3));
}

function round1(x: number): number {
  return Number(x.toFixed(1));
}
