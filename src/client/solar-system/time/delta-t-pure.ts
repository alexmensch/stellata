// ΔT = TT − UT: how far Earth's rotation has drifted from uniform time.
// Espenak & Meeus polynomial set, -1999 to +3000. See README.md § Timescales.

import { DAYS_PER_JULIAN_YEAR, J2000_JD } from '../../util/astronomy-constants';

function poly(x: number, coeffs: readonly number[]): number {
  let sum = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) sum = sum * x + coeffs[i];
  return sum;
}

// The long-term parabola (Morrison & Stephenson) both tails run on, in
// centuries from 1820. It carries the whole pre-Roman range on its own:
// 74 000 s — a full 20.6 h — at the clock's lower bound.
function longTermParabola(y: number): number {
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

// The polynomial set assumes the Moon's secular acceleration is −26″/cy²;
// the eclipse canons and the ELP/DE lunar ephemerides the model is pinned
// against use −25.858. NASA's own correction reconciles the two — dropping
// it reads 202 s high at 2000 BC, which is 0.84° of Earth rotation under
// every deep-time eclipse ground point.
function lunarSecularAccelerationCorrection(y: number): number {
  return -0.000012932 * (y - 1955) * (y - 1955);
}

/**
 * ΔT in seconds at decimal year `y`. Fifteen intervals — thirteen
 * fitted, plus the long-term parabola on each tail — plus the
 * lunar-secular-acceleration correction above.
 */
export function deltaTSecondsAtYear(y: number): number {
  return espenakPolynomialSeconds(y) + lunarSecularAccelerationCorrection(y);
}

// Each fitted interval is a polynomial in its own re-centred argument, so
// the branch order below is load-bearing.
function espenakPolynomialSeconds(y: number): number {
  if (y < -500) return longTermParabola(y);
  if (y < 500) {
    return poly(y / 100, [
      10583.6, -1014.41, 33.78311, -5.952053,
      -0.1798452, 0.022174192, 0.0090316521,
    ]);
  }
  if (y < 1600) {
    return poly((y - 1000) / 100, [
      1574.2, -556.01, 71.23472, 0.319781,
      -0.8503463, -0.005050998, 0.0083572073,
    ]);
  }
  if (y < 1700) return poly(y - 1600, [120, -0.9808, -0.01532, 1 / 7129]);
  if (y < 1800) {
    return poly(y - 1700, [8.83, 0.1603, -0.0059285, 0.00013336, -1 / 1174000]);
  }
  if (y < 1860) {
    return poly(y - 1800, [
      13.72, -0.332447, 0.0068612, 0.0041116,
      -0.00037436, 0.0000121272, -0.0000001699, 0.000000000875,
    ]);
  }
  if (y < 1900) {
    return poly(y - 1860, [
      7.62, 0.5737, -0.251754, 0.01680668, -0.0004473624, 1 / 233174,
    ]);
  }
  if (y < 1920) {
    return poly(y - 1900, [-2.79, 1.494119, -0.0598939, 0.0061966, -0.000197]);
  }
  if (y < 1941) return poly(y - 1920, [21.20, 0.84493, -0.076100, 0.0020936]);
  if (y < 1961) return poly(y - 1950, [29.07, 0.407, -1 / 233, 1 / 2547]);
  if (y < 1986) return poly(y - 1975, [45.45, 1.067, -1 / 260, -1 / 718]);
  if (y < 2005) {
    return poly(y - 2000, [
      63.86, 0.3345, -0.060374, 0.0017275, 0.000651814, 0.00002373599,
    ]);
  }
  if (y < 2050) return poly(y - 2000, [62.92, 0.32217, 0.005589]);
  if (y < 2150) return longTermParabola(y) - 0.5628 * (2150 - y);
  return longTermParabola(y);
}

/** Decimal year of a Julian Date, to the precision ΔT resolves. */
export function decimalYearOfJd(jd: number): number {
  return 2000 + (jd - J2000_JD) / DAYS_PER_JULIAN_YEAR;
}

/** ΔT in seconds at Julian Date `jd`. Either scale may be passed: over
 *  one ΔT-worth of time the function itself changes by under 0.1 s. */
export function deltaTSeconds(jd: number): number {
  return deltaTSecondsAtYear(decimalYearOfJd(jd));
}
