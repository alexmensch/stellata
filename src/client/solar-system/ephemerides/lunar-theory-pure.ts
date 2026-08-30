// Truncated ELP-2000/82 lunar theory (Meeus, Astronomical Algorithms
// 2nd ed., ch. 47): the Moon's geocentric position in the mean ecliptic
// and equinox of date. See README.md § Moon ephemeris.

import { J2000_JD } from '../../util/astronomy-constants';

const DEG = Math.PI / 180;
const DAYS_PER_JULIAN_CENTURY = 36525;

/** Mean geocentric distance the Σr sum is a correction to, km. */
const MEAN_DISTANCE_KM = 385000.56;

// Recalibration of the series against DE441 (arcsec, T in Julian
// centuries): T²/T³ on the mean longitude, and on the D / M′ / F
// fundamental arguments, which the largest periodic terms amplify
// coherently. Without the set, the along-track error reaches 518″ at the
// clock's lower bound — a full umbra width of eclipse-path displacement.
// Derivation and the residual it leaves: README.md § Moon ephemeris.
const MEAN_LON_T2_ARCSEC = 2.501823e-2;
const MEAN_LON_T3_ARCSEC = -3.983848e-3;
const ARG_D_T2_ARCSEC = -1.842598e-2;
const ARG_D_T3_ARCSEC = 4.166853e-3;
const ARG_MP_T2_ARCSEC = -3.764895e-2;
const ARG_MP_T3_ARCSEC = 2.327369e-3;
const ARG_F_T2_ARCSEC = -1.987338e-2;
const ARG_F_T3_ARCSEC = 5.602035e-3;

/** One recalibration pair evaluated at `T`, arcsec → degrees. */
function secularCorrDeg(T: number, t2Arcsec: number, t3Arcsec: number): number {
  return (t2Arcsec * T * T + t3Arcsec * T * T * T) / 3600;
}

const wrapDeg = (x: number): number => ((x % 360) + 360) % 360;

// Table 47.A: D, M, M′, F, Σl (1e-6 deg), Σr (1e-3 km).
const LON_DIST_TERMS = [
  0, 0, 1, 0, 6288774, -20905355,
  2, 0, -1, 0, 1274027, -3699111,
  2, 0, 0, 0, 658314, -2955968,
  0, 0, 2, 0, 213618, -569925,
  0, 1, 0, 0, -185116, 48888,
  0, 0, 0, 2, -114332, -3149,
  2, 0, -2, 0, 58793, 246158,
  2, -1, -1, 0, 57066, -152138,
  2, 0, 1, 0, 53322, -170733,
  2, -1, 0, 0, 45758, -204586,
  0, 1, -1, 0, -40923, -129620,
  1, 0, 0, 0, -34720, 108743,
  0, 1, 1, 0, -30383, 104755,
  2, 0, 0, -2, 15327, 10321,
  0, 0, 1, 2, -12528, 0,
  0, 0, 1, -2, 10980, 79661,
  4, 0, -1, 0, 10675, -34782,
  0, 0, 3, 0, 10034, -23210,
  4, 0, -2, 0, 8548, -21636,
  2, 1, -1, 0, -7888, 24208,
  2, 1, 0, 0, -6766, 30824,
  1, 0, -1, 0, -5163, -8379,
  1, 1, 0, 0, 4987, -16675,
  2, -1, 1, 0, 4036, -12831,
  2, 0, 2, 0, 3994, -10445,
  4, 0, 0, 0, 3861, -11650,
  2, 0, -3, 0, 3665, 14403,
  0, 1, -2, 0, -2689, -7003,
  2, 0, -1, 2, -2602, 0,
  2, -1, -2, 0, 2390, 10056,
  1, 0, 1, 0, -2348, 6322,
  2, -2, 0, 0, 2236, -9884,
  0, 1, 2, 0, -2120, 5751,
  0, 2, 0, 0, -2069, 0,
  2, -2, -1, 0, 2048, -4950,
  2, 0, 1, -2, -1773, 4130,
  2, 0, 0, 2, -1595, 0,
  4, -1, -1, 0, 1215, -3958,
  0, 0, 2, 2, -1110, 0,
  3, 0, -1, 0, -892, 3258,
  2, 1, 1, 0, -810, 2616,
  4, -1, -2, 0, 759, -1897,
  0, 2, -1, 0, -713, -2117,
  2, 2, -1, 0, -700, 2354,
  2, 1, -2, 0, 691, 0,
  2, -1, 0, -2, 596, 0,
  4, 0, 1, 0, 549, -1423,
  0, 0, 4, 0, 537, -1117,
  4, -1, 0, 0, 520, -1571,
  1, 0, -2, 0, -487, -1739,
  2, 1, 0, -2, -399, 0,
  0, 0, 2, -2, -381, -4421,
  1, 1, 1, 0, 351, 0,
  3, 0, -2, 0, -340, 0,
  4, 0, -3, 0, 330, 0,
  2, -1, 2, 0, 327, 0,
  0, 2, 1, 0, -323, 1165,
  1, 1, -1, 0, 299, 0,
  2, 0, 3, 0, 294, 0,
  2, 0, -1, -2, 0, 8752,
];

// Table 47.B: D, M, M′, F, Σb (1e-6 deg).
const LAT_TERMS = [
  0, 0, 0, 1, 5128122,
  0, 0, 1, 1, 280602,
  0, 0, 1, -1, 277693,
  2, 0, 0, -1, 173237,
  2, 0, -1, 1, 55413,
  2, 0, -1, -1, 46271,
  2, 0, 0, 1, 32573,
  0, 0, 2, 1, 17198,
  2, 0, 1, -1, 9266,
  0, 0, 2, -1, 8822,
  2, -1, 0, -1, 8216,
  2, 0, -2, -1, 4324,
  2, 0, 1, 1, 4200,
  2, 1, 0, -1, -3359,
  2, -1, -1, 1, 2463,
  2, -1, 0, 1, 2211,
  2, -1, -1, -1, 2065,
  0, 1, -1, -1, -1870,
  4, 0, -1, -1, 1828,
  0, 1, 0, 1, -1794,
  0, 0, 0, 3, -1749,
  0, 1, -1, 1, -1565,
  1, 0, 0, 1, -1491,
  0, 1, 1, 1, -1475,
  0, 1, 1, -1, -1410,
  0, 1, 0, -1, -1344,
  1, 0, 0, -1, -1335,
  0, 0, 3, 1, 1107,
  4, 0, 0, -1, 1021,
  4, 0, -1, 1, 833,
  0, 0, 1, -3, 777,
  4, 0, -2, 1, 671,
  2, 0, 0, -3, 607,
  2, 0, 2, -1, 596,
  2, -1, 1, -1, 491,
  2, 0, -2, 1, -451,
  0, 0, 3, -1, 439,
  2, 0, 2, 1, 422,
  2, 0, -3, -1, 421,
  2, 1, -1, 1, -366,
  2, 1, 0, 1, -351,
  4, 0, 0, 1, 331,
  2, -1, 1, 1, 315,
  2, -2, 0, -1, 302,
  0, 0, 1, 3, -283,
  2, 1, 1, -1, -229,
  1, 1, 0, -1, 223,
  1, 1, 0, 1, 223,
  0, 1, -2, -1, -220,
  2, 1, -1, -1, -220,
  1, 0, 1, 1, -185,
  2, -1, -2, -1, 181,
  0, 1, 2, 1, -177,
  4, 0, -2, -1, 176,
  4, -1, -1, -1, 166,
  1, 0, 1, -1, -164,
  4, 0, 1, -1, 132,
  1, 0, -1, -1, -119,
  4, -1, 0, -1, 115,
  2, -2, 0, 1, 107,
];

export interface MoonGeocentric {
  /** Ecliptic longitude λ (deg), mean equinox of date, no nutation. */
  readonly lonDeg: number;
  /** Ecliptic latitude β (deg). */
  readonly latDeg: number;
  /** Distance from Earth's centre (km). */
  readonly distKm: number;
}

/**
 * The Moon's geocentric position at Julian Date `jdTt` (TT), referred to
 * the **mean ecliptic and equinox of date**. Nutation is deliberately
 * omitted: the caller rotates onto the J2000 mean ecliptic, and mean-to-mean
 * is exactly the precession-only chain.
 *
 * Meeus quotes ~10″ in λ and ~4″ in β near the present epoch, degrading
 * away from it; `moon-vector-truth.test.ts` measures the real figure
 * across the model clock's whole span against JPL Horizons.
 */
export function moonGeocentricOfDate(jdTt: number): MoonGeocentric {
  const T = (jdTt - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  const { lp, d, m, mp, f, e } = lunarArgumentsDeg(jdTt);

  const a1 = 119.75 + 131.849 * T;
  const a2 = 53.09 + 479264.290 * T;
  const a3 = 313.45 + 481266.484 * T;

  const e2 = e * e;

  const dRad = d * DEG;
  const mRad = m * DEG;
  const mpRad = mp * DEG;
  const fRad = f * DEG;

  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < LON_DIST_TERMS.length; i += 6) {
    const cM = LON_DIST_TERMS[i + 1];
    const arg = LON_DIST_TERMS[i] * dRad + cM * mRad
      + LON_DIST_TERMS[i + 2] * mpRad + LON_DIST_TERMS[i + 3] * fRad;
    const damp = cM === 0 ? 1 : (cM === 1 || cM === -1 ? e : e2);
    sumL += LON_DIST_TERMS[i + 4] * Math.sin(arg) * damp;
    sumR += LON_DIST_TERMS[i + 5] * Math.cos(arg) * damp;
  }

  let sumB = 0;
  for (let i = 0; i < LAT_TERMS.length; i += 5) {
    const cM = LAT_TERMS[i + 1];
    const arg = LAT_TERMS[i] * dRad + cM * mRad
      + LAT_TERMS[i + 2] * mpRad + LAT_TERMS[i + 3] * fRad;
    const damp = cM === 0 ? 1 : (cM === 1 || cM === -1 ? e : e2);
    sumB += LAT_TERMS[i + 4] * Math.sin(arg) * damp;
  }

  sumL += 3958 * Math.sin(a1 * DEG)
    + 1962 * Math.sin((lp - f) * DEG)
    + 318 * Math.sin(a2 * DEG);
  sumB += -2235 * Math.sin(lp * DEG)
    + 382 * Math.sin(a3 * DEG)
    + 175 * Math.sin((a1 - f) * DEG)
    + 175 * Math.sin((a1 + f) * DEG)
    + 127 * Math.sin((lp - mp) * DEG)
    - 115 * Math.sin((lp + mp) * DEG);

  const meanLonCorrDeg = secularCorrDeg(T, MEAN_LON_T2_ARCSEC, MEAN_LON_T3_ARCSEC);

  return {
    lonDeg: lp + sumL / 1e6 - meanLonCorrDeg,
    latDeg: sumB / 1e6,
    distKm: MEAN_DISTANCE_KM + sumR / 1e3,
  };
}

/** The five fundamental arguments (deg, wrapped) and the eccentricity
 *  factor. Exported for the worked-example test, which pins them against
 *  Meeus's own intermediate values — a mistyped polynomial otherwise only
 *  shows as a slow drift in the summed series. */
export function lunarArgumentsDeg(jdTt: number): {
  lp: number; d: number; m: number; mp: number; f: number; e: number;
} {
  const T = (jdTt - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  return {
    lp: wrapDeg(218.3164477 + 481267.88123421 * T - 0.0015786 * T2
      + T3 / 538841 - T4 / 65194000),
    d: wrapDeg(297.8501921 + 445267.1114034 * T - 0.0018819 * T2
      + T3 / 545868 - T4 / 113065000
      + secularCorrDeg(T, ARG_D_T2_ARCSEC, ARG_D_T3_ARCSEC)),
    m: wrapDeg(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000),
    mp: wrapDeg(134.9633964 + 477198.8675055 * T + 0.0087414 * T2
      + T3 / 69699 - T4 / 14712000
      + secularCorrDeg(T, ARG_MP_T2_ARCSEC, ARG_MP_T3_ARCSEC)),
    f: wrapDeg(93.2720950 + 483202.0175233 * T - 0.0036539 * T2
      - T3 / 3526000 + T4 / 863310000
      + secularCorrDeg(T, ARG_F_T2_ARCSEC, ARG_F_T3_ARCSEC)),
    e: 1 - 0.002516 * T - 0.0000074 * T2,
  };
}
