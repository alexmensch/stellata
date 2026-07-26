// Turning Horizons' wrapped mean anomaly into the continuous mean longitude
// the wire format carries. See README.md § Unwrapping the mean longitude.

/**
 * Mean longitudes made continuous: each step gains the whole number of turns
 * that brings it closest to the advance the reported mean motion predicts.
 *
 * The mean-motion hint is what makes this exact at any cadence. Taking the
 * shortest arc instead would silently drop a revolution wherever a sample
 * interval covers more than half an orbit — true for Mercury at any cadence
 * over 44 days.
 *
 * Throws on a non-advancing step: every planet is prograde, so a backward
 * step means the revolution count was picked wrong and the emitted table
 * would interpolate a planet through most of an orbit backwards.
 */
export function unwrapMeanLongitude(
  lambdaDeg: readonly number[],
  nDegPerDay: readonly number[],
  stepDays: number,
): number[] {
  if (lambdaDeg.length !== nDegPerDay.length) {
    throw new Error(`${lambdaDeg.length} longitudes against ${nDegPerDay.length} mean motions`);
  }
  const out: number[] = [];
  for (let i = 0; i < lambdaDeg.length; i++) {
    if (i === 0) {
      out.push(lambdaDeg[0]);
      continue;
    }
    const expected = 0.5 * (nDegPerDay[i - 1] + nDegPerDay[i]) * stepDays;
    const raw = lambdaDeg[i] - lambdaDeg[i - 1];
    const step = raw + 360 * Math.round((expected - raw) / 360);
    if (step <= 0) {
      throw new Error(`mean longitude steps back by ${(-step).toFixed(3)}° at sample ${i}`);
    }
    out.push(out[i - 1] + step);
  }
  return out;
}
