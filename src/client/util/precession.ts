// ICRS/J2000 ↔ the mean equator and equinox of another epoch: the IAU 1976
// (Lieske) angles for near-epoch work, and the Vondrák long-term model for
// the whole model-clock span. See README.md § precession.ts.

import { ARCSEC_TO_RAD, DAYS_PER_JULIAN_YEAR, J2000_JD } from './astronomy-constants';
import {
  raDecFromUnitVector,
  unitVectorFromRaDec,
  type SkyPosition,
  type UnitVector,
} from './equatorial-basis';

const JULIAN_CENTURY_DAYS = 36525;
const BESSELIAN_B1900_JD = 2415020.31352;
const TROPICAL_YEAR_DAYS = 365.242198781;

/** Row-major 3×3 rotation acting on an equatorial Cartesian direction. */
export type Rotation3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** Besselian epoch → JD (Lieske 1979): tropical years counted from B1900.0. */
export function besselianEpochToJd(besselianYear: number): number {
  return BESSELIAN_B1900_JD + (besselianYear - 1900) * TROPICAL_YEAR_DAYS;
}

/** The equinox the IAU constellation boundaries are drawn at (Delporte 1930):
 *  1874 Dec 31.76. Getting this epoch wrong by months leaves the boundaries
 *  looking plausible while flipping positions that sit within an arcsecond of
 *  a wall — see ../constellation-boundaries/iau-geometry/README.md
 *  § ρ Aquilae. */
export const B1875_JD = besselianEpochToJd(1875);

export interface PrecessionAngles {
  zetaRad: number;
  zRad: number;
  thetaRad: number;
}

/** IAU 1976 accumulated precession from J2000.0 to `jd`. All three are
 *  negative for an epoch before J2000. */
export function precessionAnglesFromJ2000(jd: number): PrecessionAngles {
  const t = (jd - J2000_JD) / JULIAN_CENTURY_DAYS;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    zetaRad: (2306.2181 * t + 0.30188 * t2 + 0.017998 * t3) * ARCSEC_TO_RAD,
    zRad: (2306.2181 * t + 1.09468 * t2 + 0.018203 * t3) * ARCSEC_TO_RAD,
    thetaRad: (2004.3109 * t - 0.42665 * t2 - 0.041833 * t3) * ARCSEC_TO_RAD,
  };
}

/** Rotation carrying an ICRS/J2000 direction to the mean equator and equinox
 *  of `jd`. Composed as Rz(−z)·Ry(−θ)·Rz(−ζ): θ turns the pole the SAME way
 *  ζ and z turn the equinox, and negating it lands every position 2θ ≈ 1.4°
 *  off the correct declination while still looking plausible. */
export function precessionRotationFromJ2000(jd: number): Rotation3 {
  const { zetaRad, zRad, thetaRad } = precessionAnglesFromJ2000(jd);
  const cZeta = Math.cos(zetaRad);
  const sZeta = Math.sin(zetaRad);
  const cZ = Math.cos(zRad);
  const sZ = Math.sin(zRad);
  const cTheta = Math.cos(thetaRad);
  const sTheta = Math.sin(thetaRad);
  return [
    cZeta * cTheta * cZ - sZeta * sZ, -sZeta * cTheta * cZ - cZeta * sZ, -sTheta * cZ,
    cZeta * cTheta * sZ + sZeta * cZ, -sZeta * cTheta * sZ + cZeta * cZ, -sTheta * sZ,
    cZeta * sTheta, -sZeta * sTheta, cTheta,
  ];
}

/** J2000 → the rotation's epoch. */
export function precessDirection(rotation: Rotation3, v: UnitVector): UnitVector {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = rotation;
  return {
    x: m00 * v.x + m01 * v.y + m02 * v.z,
    y: m10 * v.x + m11 * v.y + m12 * v.z,
    z: m20 * v.x + m21 * v.y + m22 * v.z,
  };
}

/** The rotation's epoch → J2000. Orthonormal, so the inverse is the
 *  transpose. */
export function unprecessDirection(rotation: Rotation3, v: UnitVector): UnitVector {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = rotation;
  return {
    x: m00 * v.x + m10 * v.y + m20 * v.z,
    y: m01 * v.x + m11 * v.y + m21 * v.z,
    z: m02 * v.x + m12 * v.y + m22 * v.z,
  };
}

// Vondrák, Capitaine & Wallace 2011 (A&A 534 A22) + 2012 corrigendum:
// precession of the ecliptic and of the equator over ±200 kyr. Agrees with
// IAU 2006 at J2000 and stays within 100 µas through the 20th–21st
// centuries — the Lieske cubics above reach arcminutes at the model
// clock's bounds, where these hold to a few arcseconds.
//
// Rows: period (yr), then the cosine and sine amplitudes (arcsec) of the
// two pole components.
const ECLIPTIC_POLE_PERIODIC = [
  708.15, -5486.751211, -684.661560, 667.666730, -5523.863691,
  2309.00, -17.127623, 2446.283880, -2354.886252, -549.747450,
  1620.00, -617.517403, 399.671049, -428.152441, -310.998056,
  492.20, 413.442940, -356.652376, 376.202861, 421.535876,
  1183.00, 78.614193, -186.387003, 184.778874, -36.776172,
  622.00, -180.732815, -316.800070, 335.321713, -145.278396,
  882.00, -87.676083, 198.296701, -185.138669, -34.744450,
  547.00, 46.140315, 101.135679, -120.972830, 22.885731,
];
const ECLIPTIC_POLE_POLY_P = [5851.607687, -0.1189000, -0.00028913, 0.000000101];
const ECLIPTIC_POLE_POLY_Q = [-1600.886300, 1.1689818, -0.00000020, -0.000000437];

const EQUATOR_POLE_PERIODIC = [
  256.75, -819.940624, 75004.344875, 81491.287984, 1558.515853,
  708.15, -8444.676815, 624.033993, 787.163481, 7774.939698,
  274.20, 2600.009459, 1251.136893, 1251.296102, -2219.534038,
  241.45, 2755.175630, -1102.212834, -1257.950837, -2523.969396,
  2309.00, -167.659835, -2660.664980, -2966.799730, 247.850422,
  492.20, 871.855056, 699.291817, 639.744522, -846.485643,
  396.10, 44.769698, 153.167220, 131.600209, -1393.124055,
  288.90, -512.313065, -950.865637, -445.040117, 368.526116,
  231.10, -819.415595, 499.754645, 584.522874, 749.045012,
  1610.00, -538.071099, -145.188210, -89.756563, 444.704518,
  620.00, -189.793622, 558.116553, 524.429630, 235.934465,
  157.87, -402.922932, -23.923029, -13.549067, 374.049623,
  220.30, 179.516345, -165.405086, -210.157124, -171.330180,
  1200.00, -9.814756, 9.344131, -44.919798, -22.899655,
];
const EQUATOR_POLE_POLY_X = [5453.282155, 0.4252841, -0.00037173, -0.000000152];
const EQUATOR_POLE_POLY_Y = [-73750.930350, -0.7675452, -0.00018725, 0.000000231];

// The obliquity the Vondrák model is defined against (84381.406″, IAU
// 2006). Deliberately NOT J2000_OBLIQUITY_RAD (84381.448″, IAU 1976):
// substituting the shared constant perturbs a published series by 0.042″
// for no gain, and the two are used for different things.
const VONDRAK_EPS0_RAD = 84381.406 * ARCSEC_TO_RAD;

function julianEpochOf(jd: number): number {
  return 2000 + (jd - J2000_JD) / DAYS_PER_JULIAN_YEAR;
}

/** Evaluate one Vondrák pole pair (periodic + polynomial), arcsec. */
function vondrakPair(
  jd: number,
  periodic: readonly number[],
  polyA: readonly number[],
  polyB: readonly number[],
): { a: number; b: number } {
  const t = (julianEpochOf(jd) - 2000) / 100;
  const w = 2 * Math.PI * t;
  let a = 0;
  let b = 0;
  for (let i = 0; i < periodic.length; i += 5) {
    const arg = w / periodic[i];
    const s = Math.sin(arg);
    const c = Math.cos(arg);
    a += c * periodic[i + 1] + s * periodic[i + 3];
    b += c * periodic[i + 2] + s * periodic[i + 4];
  }
  let p = 1;
  for (let i = 0; i < polyA.length; i++) {
    a += polyA[i] * p;
    b += polyB[i] * p;
    p *= t;
  }
  return { a, b };
}

/** Unit vector toward the ecliptic pole of `jd`, in ICRS. */
export function longTermEclipticPole(jd: number): UnitVector {
  const { a, b } = vondrakPair(jd, ECLIPTIC_POLE_PERIODIC, ECLIPTIC_POLE_POLY_P, ECLIPTIC_POLE_POLY_Q);
  const p = a * ARCSEC_TO_RAD;
  const q = b * ARCSEC_TO_RAD;
  const w = Math.sqrt(Math.max(0, 1 - p * p - q * q));
  const s = Math.sin(VONDRAK_EPS0_RAD);
  const c = Math.cos(VONDRAK_EPS0_RAD);
  return { x: p, y: -q * c - w * s, z: -q * s + w * c };
}

/** Unit vector toward the celestial (equator) pole of `jd`, in ICRS —
 *  Earth's rotation axis, precession only. */
export function longTermEquatorPole(jd: number): UnitVector {
  const { a, b } = vondrakPair(jd, EQUATOR_POLE_PERIODIC, EQUATOR_POLE_POLY_X, EQUATOR_POLE_POLY_Y);
  const x = a * ARCSEC_TO_RAD;
  const y = b * ARCSEC_TO_RAD;
  return { x, y, z: Math.sqrt(Math.max(0, 1 - x * x - y * y)) };
}

function cross(a: UnitVector, b: UnitVector): UnitVector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: UnitVector): UnitVector {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/** The equinox of `jd` — the ascending node of the equator of date on the
 *  ecliptic of date — as an ICRS unit vector. */
export function longTermEquinox(jd: number): UnitVector {
  return normalize(cross(longTermEquatorPole(jd), longTermEclipticPole(jd)));
}

function frameFrom(pole: UnitVector, equinox: UnitVector): Rotation3 {
  const mid = cross(pole, equinox);
  return [
    equinox.x, equinox.y, equinox.z,
    mid.x, mid.y, mid.z,
    pole.x, pole.y, pole.z,
  ];
}

/** Rotation carrying an ICRS direction to the **mean equator and equinox**
 *  of `jd`, valid across the whole model clock. Long-term sibling of
 *  `precessionRotationFromJ2000`. */
export function longTermEquatorRotationFromJ2000(jd: number): Rotation3 {
  return frameFrom(longTermEquatorPole(jd), longTermEquinox(jd));
}

/** Rotation carrying an ICRS direction to the **mean ecliptic and equinox**
 *  of `jd` — the frame a lunar or solar theory's λ/β are referred to. */
export function longTermEclipticRotationFromJ2000(jd: number): Rotation3 {
  return frameFrom(longTermEclipticPole(jd), longTermEquinox(jd));
}

export function precessRaDec(rotation: Rotation3, pos: SkyPosition): SkyPosition {
  return raDecFromUnitVector(
    precessDirection(rotation, unitVectorFromRaDec(pos.raDeg, pos.decDeg)),
  );
}

export function unprecessRaDec(rotation: Rotation3, pos: SkyPosition): SkyPosition {
  return raDecFromUnitVector(
    unprecessDirection(rotation, unitVectorFromRaDec(pos.raDeg, pos.decDeg)),
  );
}
