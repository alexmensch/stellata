// Viewport-scaling sweep: the measurement order, the log-log fit, and what
// its slope says about what the frame is bound by.
// README.md § Sweep mode.

export const DEFAULT_SWEEP_SCALES = [0.5, 1, 1.5, 2] as const;

/** Slope at or above this: the frame tracks pixel count, so it is bound by
 *  fill. At or below the lower one it barely moves with area at all, so the
 *  cost is vertex or CPU work. Between them, both matter. */
export const FILL_BOUND_SLOPE = 0.8;
export const VERTEX_BOUND_SLOPE = 0.3;

export type Bound = 'fill' | 'vertex/cpu' | 'mixed' | 'inconclusive';

export interface SweepPoint {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  /** Backing-store pixels, not CSS pixels — the fill the GPU actually paid
   *  for, which is the viewport times dpr squared. */
  readonly px: number;
  readonly ms: number;
  readonly vsyncClamped: boolean;
}

export interface SweepFit {
  readonly slope: number;
  readonly r2: number;
  readonly bound: Bound;
  readonly points: number;
}

/**
 * Scale 1 first and last, the rest ascending in between. The two scale-1
 * medians bracket the sweep the way the differential's paired baselines
 * bracket a row: a GPU ramping its clocks walks the frame time down across
 * the whole sweep, and a slope fitted through that drift reads as a
 * dependence on area that is really a dependence on elapsed time.
 */
export function sweepOrder(scales: readonly number[]): number[] {
  const others = [...new Set(scales)].filter((s) => s !== 1).sort((a, b) => a - b);
  return [1, ...others, 1];
}

/**
 * Ordinary least squares through log(px) against log(ms). The slope is the
 * exponent: 1 means cost is proportional to area, 0 means area does not
 * enter. Duplicate scales are averaged in by the fit itself — the two
 * scale-1 points pull the line toward their mean, which is what bracketing
 * a drift is supposed to do.
 */
export function fitLogLog(points: readonly SweepPoint[]): SweepFit {
  const usable = points.filter((p) => p.px > 0 && p.ms > 0);
  if (usable.length < 2) {
    return { slope: 0, r2: 0, bound: 'inconclusive', points: usable.length };
  }
  const xs = usable.map((p) => Math.log(p.px));
  const ys = usable.map((p) => Math.log(p.ms));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [i, x] of xs.entries()) {
    const dx = x - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0) {
    return { slope: 0, r2: 0, bound: 'inconclusive', points: usable.length };
  }
  const slope = covariance / varianceX;
  const r2 = varianceY === 0 ? 1 : (covariance * covariance) / (varianceX * varianceY);
  return {
    slope,
    r2,
    bound: classifyBound(slope, points),
    points: usable.length,
  };
}

/**
 * A single vsync-clamped point makes the whole fit inconclusive rather
 * than merely noisy: that point measures the panel instead of the frame,
 * so it flattens the line toward zero and would read as vertex-bound.
 */
export function classifyBound(slope: number, points: readonly SweepPoint[]): Bound {
  if (points.some((p) => p.vsyncClamped)) return 'inconclusive';
  if (slope >= FILL_BOUND_SLOPE) return 'fill';
  if (slope <= VERTEX_BOUND_SLOPE) return 'vertex/cpu';
  return 'mixed';
}

/** How far the instrument moved across the sweep, from the two scale-1
 *  points. Zero when the sweep did not measure scale 1 twice. */
export function sweepBracketMs(points: readonly SweepPoint[]): number {
  const ones = points.filter((p) => p.scale === 1);
  if (ones.length < 2) return 0;
  return Math.abs(ones[ones.length - 1].ms - ones[0].ms);
}
