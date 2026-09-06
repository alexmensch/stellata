// Pure statistics for the frame-cost harness: dwell summaries and
// baseline-vs-disabled differential rows. See README.md.

/** How a row's milliseconds were measured. Three different instruments —
 *  never compare numbers across two of them. */
export const GPU_FRAME_METHODS = ['timer-query', 'timestamp', 'raf-delta'] as const;

export type GpuFrameMethod = (typeof GPU_FRAME_METHODS)[number];

/** Every row `buildPassToggles` can produce, in table order. Lives here
 *  rather than with the toggles so a caller can check a requested key
 *  without pulling the renderer in: an unrecognised key would otherwise
 *  filter the roster to empty and read as the sweep being refused. */
export const PRICED_PASS_KEYS = [
  'localDepth', 'mwBand', 'lgEmission', 'cloudAbsorption', 'hdrChain',
  'tonemapOp', 'statisticWrites', 'summation', 'summationTaps', 'mrtAttachments',
  'reduction', 'coreMask', 'extinctionPrepass', 'emptyPass',
] as const;

export type PricedPassKey = (typeof PRICED_PASS_KEYS)[number];

/** Frames discarded before the first dwell of a measurement. Long because
 *  an Apple-silicon GPU ramps its clocks under sustained load, so a
 *  measurement started cold walks its frame time down for tens of
 *  seconds. Shared with the headless runner's dwell mode, which needs the
 *  same ramp absorbed for the same reason. */
export const WARMUP_FRAMES = 180;

/** Frames after a pass is restored before the next dwell, so the trailing
 *  baseline is not sampled while the exposure is still re-converging —
 *  README.md § Restore transients. The headless runner's `--roundtrip`
 *  waits the same count for the same reason (`scripts/perf/README.md`). */
export const SETTLE_FRAMES = 30;

/** How close to a whole number of display intervals counts as sitting on
 *  one, as a fraction of the interval: 1 ms at 60 Hz, 0.5 ms at 120. Never
 *  a fixed millisecond, which on a small interval sits within reach of some
 *  multiple whatever the frame cost. README.md § Reading a row. */
export const CADENCE_TOLERANCE = 0.06;

export function vsyncClampToleranceMs(cadenceMs: number): number {
  return cadenceMs * CADENCE_TOLERANCE;
}

/**
 * A wall-clock median the display decided rather than the frame: it sits on
 * a whole number of the measured idle interval, with a spread tighter than
 * the tolerance. Any whole number, because a frame that overran one interval
 * is held to the next — 12 ms of work on a 120 Hz panel reads 16.67, still
 * the display's number.
 *
 * `null` means the samples are not wall clock — a GPU duration is a span the
 * hardware reports, and nothing holds it to a display period.
 */
export function isVsyncClamped(p50: number, iqrMs: number, cadenceMs: number | null): boolean {
  if (cadenceMs === null || !(cadenceMs > 0)) return false;
  const toleranceMs = vsyncClampToleranceMs(cadenceMs);
  if (iqrMs >= toleranceMs) return false;
  const intervals = Math.max(1, Math.round(p50 / cadenceMs));
  return Math.abs(p50 - intervals * cadenceMs) <= toleranceMs;
}

/**
 * A dwell whose wall-clock median the display's refresh interval set, so a
 * differential across it cannot resolve a sub-interval cost. Two ways in,
 * and both are needed:
 *
 * - **at or under one interval, whatever the spread** — the frame made every
 *   deadline with room to spare, so an addition smaller than the interval
 *   cannot appear at all. A wide spread here is dropped frames, not evidence
 *   the median measured the frame.
 * - **on a higher multiple with a tight spread** — `isVsyncClamped`. The
 *   frame overran, but consistently enough that the compositor still set the
 *   number.
 *
 * Between them lies the only honest wall-clock case: a frame comfortably
 * over one interval whose spread shows it is not pinned to the panel.
 */
export function isCadenceBound(medianMs: number, iqrMs: number, cadenceMs: number): boolean {
  if (!(cadenceMs > 0)) return false;
  return medianMs <= cadenceMs * (1 + CADENCE_TOLERANCE)
    || isVsyncClamped(medianMs, iqrMs, cadenceMs);
}

function cadenceBoundFlag(
  method: GpuFrameMethod,
  states: readonly DwellStats[],
  cadenceMs: number | undefined,
): boolean | undefined {
  if (method !== 'raf-delta' || cadenceMs === undefined) return undefined;
  return states.some((s) => isCadenceBound(s.medianMs, s.iqrMs, cadenceMs));
}

export interface DwellStats {
  readonly samples: number;
  readonly medianMs: number;
  readonly iqrMs: number;
  /** Serial structure in the samples, not a duration — see
   *  `lag1Autocorrelation`. */
  readonly lag1: number;
  /** Reduction readbacks issued per frame over the dwell. 0.5 is the
   *  every-other-frame rhythm; 1.0 is one per frame. */
  readonly readbackPerFrame: number;
  /** Faintest magnitude the frame was rendering — threshold plus the
   *  adaptation cut. What the dwell DREW, as opposed to how long it took. */
  readonly effectiveLimitMag: number;
}

/** What a dwell was, beyond the frame times themselves. */
export interface DwellContext {
  readonly readbackPerFrame: number;
  readonly effectiveLimitMag: number;
}

export interface PriceFrameRow {
  readonly pass: string;
  readonly method: GpuFrameMethod;
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
  /** Lag-1 autocorrelation of the reference dwell(s) and of the disabled
   *  one — whether each dwell's spread is alternation, noise, or drift. */
  readonly baselineLag1: number;
  readonly disabledLag1: number;
  /** Readbacks per frame in each state. The reduction's fence is the
   *  frame's only ANGLE submission barrier and its cadence is emergent, so
   *  a row whose two values differ priced a change in barrier rate on top
   *  of the pass — README.md § The readback cadence confound. */
  readonly baselineReadback: number;
  readonly disabledReadback: number;
  /** Faintest magnitude rendered in each state. **These two differing is
   *  the row failing, not a detail**: the toggle changed what the frame
   *  drew, so `savedMs` prices a different scene rather than the pass. */
  readonly baselineLimitMag: number;
  readonly disabledLimitMag: number;
  /** `raf-delta` rows, against the display's idle period: true when ANY of
   *  the row's dwells had its median set by the refresh interval rather than
   *  by the frame (`isCadenceBound`), so the row could not have resolved a
   *  sub-interval delta whatever `savedMs` says. Absent on a GPU clock, and
   *  where no cadence was measured. */
  readonly cadenceBound?: boolean;
  /** Drawing-buffer megapixels the sweep ran at, stamped by the harness —
   *  run metadata, not a dwell statistic. Both dominant passes scale with
   *  it, so a table without it cannot be compared to another table. */
  readonly bufferMpx?: number;
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

/** Interquartile spread on nearest-rank quartiles — the robust width both
 *  the differential's noise floor and the runner's dwell summary report. */
export function interquartileRange(xs: readonly number[]): number {
  return percentile(xs, 0.75) - percentile(xs, 0.25);
}

/** Average rank, ties shared, so one hitched frame carries the weight of
 *  one sample instead of the weight of its magnitude. */
function ranks(xs: readonly number[]): number[] {
  const order = xs
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x - b.x);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].x === order[i].x) j++;
    const shared = (i + j) / 2;
    for (let k = i; k <= j; k++) out[order[k].i] = shared;
    i = j + 1;
  }
  return out;
}

/** Lag-1 autocorrelation of a dwell's frame times, on ranks. Negative is
 *  alternation, zero independent scatter, positive drift — and `noiseMs`
 *  is only an honest standard error in the middle case. Reading one:
 *  README.md § Reading a row. */
export function lag1Autocorrelation(samples: readonly number[]): number {
  if (samples.length < 3) return 0;
  const r = ranks(samples);
  const mean = (r.length - 1) / 2;
  let covariance = 0;
  let variance = 0;
  for (const [i, rank] of r.entries()) {
    const deviation = rank - mean;
    variance += deviation * deviation;
    if (i + 1 < r.length) covariance += deviation * (r[i + 1] - mean);
  }
  return variance === 0 ? 0 : covariance / variance;
}

const NO_CONTEXT: DwellContext = { readbackPerFrame: 0, effectiveLimitMag: 0 };

export function summarizeDwell(
  samples: readonly number[],
  context: DwellContext = NO_CONTEXT,
): DwellStats | null {
  if (samples.length === 0) return null;
  return {
    samples: samples.length,
    medianMs: median(samples),
    iqrMs: interquartileRange(samples),
    lag1: lag1Autocorrelation(samples),
    readbackPerFrame: context.readbackPerFrame,
    effectiveLimitMag: context.effectiveLimitMag,
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
  return Math.hypot(medianStandardErrorMs(a), medianStandardErrorMs(b));
}

/** Standard error of one dwell's median, from a robust σ. Takes the two
 *  fields it reads rather than a `DwellStats`, so the runner's own dwell
 *  summary feeds the same estimator its baseline diff band is built on. */
export function medianStandardErrorMs(
  stats: { readonly samples: number; readonly iqrMs: number },
): number {
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
  cadenceMs?: number,
): PriceFrameRow {
  return assembleRow(pass, method, baseline.medianMs, disabled.medianMs, {
    cadenceBound: cadenceBoundFlag(method, [baseline, disabled], cadenceMs),
    samples: Math.min(baseline.samples, disabled.samples),
    iqrMs: Math.max(baseline.iqrMs, disabled.iqrMs),
    noiseMs: differentialNoiseMs(baseline, disabled),
    baselineLag1: baseline.lag1,
    disabledLag1: disabled.lag1,
    baselineReadback: baseline.readbackPerFrame,
    disabledReadback: disabled.readbackPerFrame,
    baselineLimitMag: baseline.effectiveLimitMag,
    disabledLimitMag: disabled.effectiveLimitMag,
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
  cadenceMs?: number,
): PriceFrameRow {
  const referenceMs = (before.medianMs + after.medianMs) / 2;
  const referenceSe =
    Math.hypot(medianStandardErrorMs(before), medianStandardErrorMs(after)) / 2;
  return assembleRow(pass, method, referenceMs, disabled.medianMs, {
    cadenceBound: cadenceBoundFlag(method, [before, after, disabled], cadenceMs),
    samples: Math.min(before.samples, after.samples, disabled.samples),
    iqrMs: Math.max(before.iqrMs, after.iqrMs, disabled.iqrMs),
    noiseMs: Math.hypot(referenceSe, medianStandardErrorMs(disabled)),
    bracketMs: Math.abs(after.medianMs - before.medianMs),
    baselineLag1: (before.lag1 + after.lag1) / 2,
    disabledLag1: disabled.lag1,
    baselineReadback: (before.readbackPerFrame + after.readbackPerFrame) / 2,
    disabledReadback: disabled.readbackPerFrame,
    baselineLimitMag: (before.effectiveLimitMag + after.effectiveLimitMag) / 2,
    disabledLimitMag: disabled.effectiveLimitMag,
  });
}

function assembleRow(
  pass: string,
  method: PriceFrameRow['method'],
  referenceMs: number,
  disabledMs: number,
  stats: {
    cadenceBound?: boolean;
    samples: number;
    iqrMs: number;
    noiseMs: number;
    bracketMs?: number;
    baselineLag1: number;
    disabledLag1: number;
    baselineReadback: number;
    disabledReadback: number;
    baselineLimitMag: number;
    disabledLimitMag: number;
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
    baselineLag1: round3(stats.baselineLag1),
    disabledLag1: round3(stats.disabledLag1),
    baselineReadback: round3(stats.baselineReadback),
    disabledReadback: round3(stats.disabledReadback),
    baselineLimitMag: round3(stats.baselineLimitMag),
    disabledLimitMag: round3(stats.disabledLimitMag),
    ...(stats.cadenceBound === undefined ? {} : { cadenceBound: stats.cadenceBound }),
  };
}

/** Three decimals, the precision every printed millisecond in this codebase
 *  is quoted to — shared with the headless runner's tables. */
export function round3(x: number): number {
  return Number(x.toFixed(3));
}

function round1(x: number): number {
  return Number(x.toFixed(1));
}
