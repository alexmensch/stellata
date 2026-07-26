// Epoch arithmetic and the chord-error tests that drive the adaptive
// trajectory grid. Pure; the network side is horizons-client.ts.
// See README.md § Adaptive grid.

/** Epochs are integer microdays of JD throughout: 0.0864 s, the finest
 *  Horizons resolves from a `JD…` time string, and exact under the
 *  repeated halving the refinement does. */
export const MICRODAYS_PER_DAY = 1_000_000;

/**
 * Finest interval refinement may emit, ~88 s. Voyager 2's 4,950 km
 * Neptune pass — the sharpest turn in the fleet — needs ~3.5 min to hold
 * the chord tolerance; everything else is coarser.
 */
export const MIN_STEP_MICRODAYS = 1024;

export const MAX_REFINE_DEPTH = 15;

/** ~33.55 d. A power-of-two multiple of the floor, so every bisection
 *  epoch is an integer microday, and fine enough that no gravity assist
 *  can sit inside one interval undetected. */
export const BASE_STEP_MICRODAYS = MIN_STEP_MICRODAYS * 2 ** MAX_REFINE_DEPTH;

/** `[jd, x, y, z, vx, vy, vz]` — AU and AU/day, as Horizons returns them. */
export type VectorRow = number[];

export function microdaysOf(jd: number): number {
  return Math.round(jd * MICRODAYS_PER_DAY);
}

export function jdOfMicrodays(mu: number): number {
  return mu / MICRODAYS_PER_DAY;
}

/**
 * Distance from `m`'s true position to where linear interpolation between
 * `a` and `b` puts it, AU. This is exactly the runtime sampler's error
 * (probe-trajectory.ts interpolates position linearly in t), so it is the
 * quantity the whole grid is built to bound.
 */
export function chordMissAu(a: VectorRow, m: VectorRow, b: VectorRow): number {
  const f = (m[0] - a[0]) / (b[0] - a[0]);
  let sum = 0;
  for (let c = 1; c <= 3; c++) {
    const d = m[c] - (a[c] + (b[c] - a[c]) * f);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

const BULGE_PARAMS = [0.25, 0.5, 0.75];

/**
 * Chord error the endpoint velocities alone predict, AU — the cubic
 * Hermite through `a` and `b` measured against their chord.
 *
 * Needed because a midpoint probe alone can be fooled: an interval whose
 * path bulges out and back crosses its own chord at the centre and reads
 * as converged. The velocities disagree in that case, so the two tests
 * together are what makes refinement safe at a coarse base step.
 */
export function hermiteBulgeAu(a: VectorRow, b: VectorRow): number {
  const h = b[0] - a[0];
  let worst = 0;
  for (const u of BULGE_PARAMS) {
    const chordTerm = u * (2 * u - 1) * (u - 1);
    const w0 = u * u * u - 2 * u * u + u;
    const w1 = u * u * u - u * u;
    let sum = 0;
    for (let c = 1; c <= 3; c++) {
      const d = chordTerm * (a[c] - b[c]) + h * (w0 * a[c + 3] + w1 * b[c + 3]);
      sum += d * d;
    }
    worst = Math.max(worst, Math.sqrt(sum));
  }
  return worst;
}

/**
 * Douglas–Peucker over the sampled polyline, keeping every row whose
 * removal would push the interpolated track further than `tolAu` from
 * where the samples say it runs. Both endpoints always survive.
 *
 * Refinement can only add rows, so it leaves the base step in place
 * wherever that step was already good enough — past Neptune that is 4×
 * finer than needed. This pass is the other half of "samples in
 * proportion to curvature", and it is exact rather than a guess: the
 * deviation between two polylines sharing a parameter is piecewise
 * linear, so its maximum is always at one of the dropped rows.
 */
export function decimateByChordError(rows: VectorRow[], tolAu: number): VectorRow[] {
  if (rows.length < 3) return [...rows];
  const keep = new Uint8Array(rows.length);
  keep[0] = 1;
  keep[rows.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, rows.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let worst = 0;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const miss = chordMissAu(rows[lo], rows[i], rows[hi]);
      if (miss > worst) {
        worst = miss;
        at = i;
      }
    }
    if (at < 0 || worst <= tolAu) continue;
    keep[at] = 1;
    stack.push([lo, at], [at, hi]);
  }
  return rows.filter((_, i) => keep[i] === 1);
}

/** One Horizons query: an evenly spaced run, or a scattered epoch list. */
export type EpochRequest =
  | { kind: 'range'; startMu: number; stopMu: number; intervals: number }
  | { kind: 'list'; mus: number[] };

/**
 * Split the epochs a refinement round wants into as few queries as
 * possible. Consecutive epochs sharing a spacing go out as one
 * `START_TIME`/`STOP_TIME`/`STEP_SIZE=<count>` range — refinement failures
 * cluster around the encounters, so a round is usually one or two of
 * these. Whatever is left over rides a `TLIST`.
 *
 * `maxListEpochs` is a hard Horizons limit, not a tuning knob: a longer
 * TLIST is truncated to 80 rows with no error.
 */
export function planEpochRequests(
  mus: number[],
  maxRangeRows: number,
  maxListEpochs: number,
): EpochRequest[] {
  const runs: EpochRequest[] = [];
  const strays: number[] = [];
  let i = 0;
  while (i < mus.length) {
    const gap = i + 1 < mus.length ? mus[i + 1] - mus[i] : 0;
    let end = i;
    while (end + 1 < mus.length && mus[end + 1] - mus[end] === gap) end++;
    if (end - i + 1 >= 3) {
      for (let from = i; from <= end; from += maxRangeRows) {
        const to = Math.min(from + maxRangeRows - 1, end);
        if (to === from) {
          strays.push(mus[from]);
          continue;
        }
        runs.push({
          kind: 'range',
          startMu: mus[from],
          stopMu: mus[to],
          intervals: to - from,
        });
      }
    } else {
      for (let k = i; k <= end; k++) strays.push(mus[k]);
    }
    i = end + 1;
  }
  for (let from = 0; from < strays.length; from += maxListEpochs) {
    runs.push({ kind: 'list', mus: strays.slice(from, from + maxListEpochs) });
  }
  return runs;
}
