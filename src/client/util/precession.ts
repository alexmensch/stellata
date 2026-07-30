// ICRS/J2000 ↔ the mean equator and equinox of another epoch, via the IAU 1976
// (Lieske) angles ζ / z / θ and the rotation they compose.
// See ../constellation-boundaries/iau-geometry/README.md § B1875.

import { ARCSEC_TO_RAD, J2000_JD } from './astronomy-constants';
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
