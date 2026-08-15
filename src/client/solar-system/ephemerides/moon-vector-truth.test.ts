// The lunar theory + precession chain vs the frozen Horizons geocentric
// vectors in data/horizons/moon-vector-truth.tsv, across the whole model
// clock. See README.md § Moon ephemeris.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lunarArgumentsDeg,
  moonGeocentricOfDate,
} from './lunar-theory-pure';
import { moonGeocentricKmAtJdTt } from './moon-ephemeris';
import { J2000_JD } from '../../util/astronomy-constants';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUTH_TSV = resolve(__dirname, '../../../../data/horizons/moon-vector-truth.tsv');

interface TruthRow {
  set: 'fit' | 'check';
  jdTt: number;
  x: number;
  y: number;
  z: number;
}

const TRUTH: TruthRow[] = readFileSync(TRUTH_TSV, 'utf-8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [set, jd, x, y, z] = line.split('\t');
    return {
      set: set as 'fit' | 'check',
      jdTt: Number(jd),
      x: Number(x),
      y: Number(y),
      z: Number(z),
    };
  });

/** Worst |Δr| (km) and its epoch over the rows passing `keep`. */
function worstError(keep: (row: TruthRow) => boolean): { km: number; jdTt: number } {
  const pos = { x: 0, y: 0, z: 0 };
  let km = 0;
  let jdTt = 0;
  for (const row of TRUTH) {
    if (!keep(row)) continue;
    moonGeocentricKmAtJdTt(row.jdTt, pos);
    const d = Math.hypot(pos.x - row.x, pos.y - row.y, pos.z - row.z);
    if (d > km) {
      km = d;
      jdTt = row.jdTt;
    }
  }
  return { km, jdTt };
}

describe('truncated ELP series', () => {
  // Meeus, Astronomical Algorithms 2nd ed., example 47.a: 1992 April 12.0
  // TD. Pinning his own intermediate arguments as well as the result is
  // what localises a mistyped table row — a wrong coefficient in one of
  // the 120 periodic terms otherwise only shows as a small offset.
  const JDE_47A = 2448724.5;

  it('reproduces Meeus example 47.a — fundamental arguments', () => {
    const a = lunarArgumentsDeg(JDE_47A);
    expect(a.lp).toBeCloseTo(134.290182, 5);
    expect(a.d).toBeCloseTo(113.842304, 5);
    expect(a.m).toBeCloseTo(97.643514, 5);
    expect(a.mp).toBeCloseTo(5.150833, 5);
    expect(a.f).toBeCloseTo(219.889721, 5);
    expect(a.e).toBeCloseTo(1.000194, 6);
  });

  it('reproduces Meeus example 47.a — λ, β, Δ', () => {
    const g = moonGeocentricOfDate(JDE_47A);
    expect(g.lonDeg).toBeCloseTo(133.162655, 5);
    expect(g.latDeg).toBeCloseTo(-3.229126, 5);
    expect(g.distKm).toBeCloseTo(368409.7, 1);
  });

  it('the mean-longitude recalibration stays under Meeus\'s own print precision', () => {
    // The T²/T³ correction is fitted across ±30 centuries; at T = −0.077
    // it must stay below the worked example's 1e-6° rounding (0.0036″),
    // or the two assertions above stop checking the untouched series.
    const g = moonGeocentricOfDate(JDE_47A);
    expect(Math.abs(g.lonDeg - 133.162655) * 3600).toBeLessThan(0.0036);
  });
});

describe('geocentric position vs JPL Horizons across the model clock', () => {
  it('holds 150 km over the whole 3000 BC – 3000 AD span', () => {
    const worst = worstError(() => true);
    expect(worst.km).toBeLessThan(150);
  });

  it('holds 20 km over the epochs the recalibration was NOT fitted to', () => {
    // The `check` rows are an independent 150-year grid; the `fit` rows
    // are the irregular sample the T²/T³ coefficients were least-squared
    // over. A regression that re-tuned the fit without improving the
    // model would pass the combined bound and fail this one.
    const worst = worstError((r) => r.set === 'check' && Math.abs(r.jdTt - J2000_JD) < 25 * 36525);
    expect(worst.km).toBeLessThan(20);
  });

  it('holds 12 km across 1900–2100, where eclipse circumstances are checked hardest', () => {
    const worst = worstError((r) => Math.abs(r.jdTt - J2000_JD) < 36525);
    expect(worst.km).toBeLessThan(12);
  });

  it('the corpus spans both clamp bounds', () => {
    const jds = TRUTH.map((r) => r.jdTt);
    expect(Math.min(...jds)).toBeLessThan(J2000_JD - 48 * 36525);
    expect(Math.max(...jds)).toBeGreaterThan(J2000_JD + 8.5 * 36525);
  });
});
