// Statistics for one dwell of frame times: the percentiles, and whether
// the numbers are the compositor's cadence rather than frame cost.
// README.md.

import {
  interquartileRange,
  isVsyncClamped,
  lag1Autocorrelation,
  median,
  percentile,
} from '../../../src/client/debug/frame-cost/frame-cost-pure';

export const DEFAULT_DWELL_FRAMES = 240;

/**
 * Rendered frames between statistic readbacks for the duration of a dwell,
 * pinning a duty cycle that is otherwise emergent and decides what the
 * GPU-stream median measures where the frame has two classes — README.md.
 * Four is the rate every clean `earth` dwell in the archive ran at, and the
 * app's own at the Sol default view
 * (`src/client/hdr/exposure/reduction/README.md` § Latency).
 */
export const DWELL_READBACK_EVERY_FRAMES = 4;

/**
 * The dwell counts requests over a window wider than the frames it times: it
 * reads the counter before an extra rAF and closes it inside the last one, so
 * the legal maximum is one request per `every` frames over `frames + 2`, not
 * over `frames`. Counting the window as `frames` puts the maximum exactly ON
 * the bound wherever `every` divides it — measured, 1200 frames at one-in-two
 * issued 601 against a bound of 601, so a one-frame phase shift would have
 * failed a sound dwell and spent a fresh arm re-taking it.
 */
const CADENCE_WINDOW_STRADDLE_FRAMES = 2;

/**
 * The pinned cadence CAPS the rate — at most one request per `every`
 * rendered frames over the window above — so a rate past
 * that bound is the lever not having taken at all. One-sided on purpose: a
 * vantage whose readback round trip outran the cadence requests LESS often,
 * which is sound and recorded. The margin is a frame either way and the fault
 * is an order of magnitude: an emergent rate against a one-in-four cap issues
 * 139 requests where 61 are legal.
 */
export function readbackCadenceHeld(
  readbackPerFrame: number,
  frames: number,
  every: number,
): boolean {
  const window = frames + CADENCE_WINDOW_STRADDLE_FRAMES;
  return Math.round(readbackPerFrame * frames) <= Math.floor(window / every) + 1;
}

/** A dwell is read in this many consecutive slices; their medians spanning
 *  more than `STATE_GUARD_TREND_MS` is the machine changing state under the
 *  dwell (the sustained-load GPU power step), and such a row compares with
 *  nothing — README.md. */
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

/** The fast end of a dwell: a per-frame cost moves it as far as the median,
 *  a wander lifts the upper half and leaves it. Printed beside the median in
 *  both gates and never marked (`../pins/README.md` § Reading `--against-pin`).
 *
 *  The tenth-percentile frame and not the single fastest, which the archive
 *  measures as the noisier of the two — repeat-pair |Δ| tails reach 1.473 ms
 *  at the minimum against 1.353 at `p10`. */
export interface FrameFloor {
  readonly p10: number;
}

export function frameFloor(samples: readonly number[] | null | undefined): FrameFloor | null {
  if (samples == null || samples.length === 0) return null;
  return { p10: percentile(samples, 0.1) };
}

/** A reading against nothing is not a move, so either side absent is null. */
export function pointMove(
  before: number | null | undefined, after: number | null | undefined,
): number | null {
  return before == null || after == null ? null : after - before;
}

/** How far the fast end moved between two dwells. Context for the median's
 *  delta in both tables, never an input to a verdict. */
export function floorMove(before: FrameFloor | null, after: FrameFloor | null): number | null {
  return pointMove(before?.p10, after?.p10);
}

/** The two ends both gates read a stream's spread off. */
export interface StreamEnds {
  readonly p10: number | null;
  readonly p90: number | null;
}

/** How far `p90 - p10` moved. The reading the gated statistic is chosen not
 *  to follow — some frames got dearer while the rest did not — so it is
 *  printed on every dwell row in both tables and marks on neither. */
export function spreadMove(before: StreamEnds | null, after: StreamEnds | null): number | null {
  const spread = (ends: StreamEnds | null): number | null =>
    pointMove(ends?.p10, ends?.p90);
  return pointMove(spread(before), spread(after));
}

/** The widest gap must exceed the lower class's own median to be a cut at
 *  all — README.md § Where the frame has two classes. */
export const CLASS_GAP_OVER_MEDIAN = 1;

/** Each class must hold at least this share of the samples for the gap above
 *  it to be a candidate cut. A class is a population the frame draws
 *  repeatedly, so one sample is never one; earth's dear class runs 22-38 % of
 *  its resolved samples across the archive, four times clear of this. */
export const CLASS_MIN_SHARE = 0.05;

/** One dwell's samples cut into the two classes a split frame draws. */
export interface SampleClasses {
  readonly cutMs: number;
  /** Below the cut: at a split-frame vantage the plain frames, the class
   *  that is a frame time. */
  readonly plain: readonly number[];
  /** Above it. Recorded and printed, never gated. */
  readonly dear: readonly number[];
}

/**
 * The two classes, or null where the samples are one population. Callers
 * gate this on the pass counters: a gap alone finds a cut at `lg` too.
 *
 * Only gaps leaving `CLASS_MIN_SHARE` on both sides are candidates, so the
 * search is not the widest gap in the stream — one dear frame above the dear
 * class beats the real separation on width alone, and the cut then lands
 * above both classes with `plain` holding the whole mixture. Measured on
 * earth's pinned stream: the classes sit 51.8 ms apart, so a single 133 ms
 * frame reverses the choice and the row reports the mixture median 13.307
 * still labelled `gpu-plain-p50`.
 */
export function sampleClasses(samples: readonly number[] | null | undefined): SampleClasses | null {
  if (samples == null || samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const minCount = Math.max(1, Math.ceil(CLASS_MIN_SHARE * sorted.length));
  let widest = 0;
  let at = 0;
  for (let i = minCount; i <= sorted.length - minCount; i++) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap > widest) [widest, at] = [gap, i];
  }
  if (at === 0) return null;
  const plain = sorted.slice(0, at);
  if (widest <= CLASS_GAP_OVER_MEDIAN * median(plain)) return null;
  return { cutMs: (sorted[at]! + sorted[at - 1]!) / 2, plain, dear: sorted.slice(at) };
}

/** No state guard: the quarters are the dwell's in time order, and a class
 *  is a subset taken out of that order. */
export interface ClassClock {
  readonly p50: number;
  readonly iqrMs: number;
  readonly samples: number;
}

export function classClock(samples: readonly number[]): ClassClock {
  return { p50: percentile(samples, 0.5), iqrMs: interquartileRange(samples), samples: samples.length };
}

/** Which clock — and which statistic of it — a row was judged on. Named in
 *  every table, and `gatingClock` returns it alongside the clock itself so no
 *  caller re-derives the choice. */
export type DwellMetric = 'gpu-p50' | 'gpu-plain-p50' | 'wall-p50' | 'compute-p10';

/** Row-key suffix (`mw120|webgpu|compute`). Its own key, so a mark on the
 *  frame and one on the compute pass are accepted separately. */
export const COMPUTE_ROW = 'compute';

/** One reader for the optional field, so no caller tells `undefined` from
 *  `null` differently. */
export function computeClock(
  dwell: { readonly computeStats?: DwellSummary | null },
): DwellSummary | null {
  return dwell.computeStats ?? null;
}

export interface GatingClock {
  readonly clock: DwellSummary;
  readonly metric: DwellMetric;
}

/**
 * Which of a dwell's two clocks a gate is entitled to act on: the GPU stream
 * where the row has one, wall only where it does not (README.md § The state
 * guard).
 *
 * Wall deltas are quantised to the display's refresh interval, so at a
 * vantage whose frame exceeds one interval they alternate between one and
 * two and the quarter medians swing by a whole interval however idle the
 * machine is — mw50 split 240 deltas 120/120 and 117/123 across two cold
 * runs whose GPU quarters spanned 0.017 ms. A state verdict read off that
 * clock is a coin flip. RELEASING.md § Perf pin already records wall p50 and
 * never marks it, for that reason; this is the same rule one field over.
 *
 * Only a gate whose row MARKS on the returned clock may use this — standing
 * a guard down on the clock a row is judged by is what it exists to prevent.
 * The whole dwell rather than its two summaries, which are the same type in
 * either order: transposing them type-checks and inverts the rule silently.
 * The metric rides along for the same reason: a caller that names the clock
 * separately from choosing it can disagree with itself and still compile.
 */
export function gatingClock(
  dwell: { readonly stats: DwellSummary; readonly gpuStats: DwellSummary | null },
): GatingClock {
  return dwell.gpuStats === null
    ? { clock: dwell.stats, metric: 'wall-p50' }
    : { clock: dwell.gpuStats, metric: 'gpu-p50' };
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
 *  encoded. README.md. */
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
