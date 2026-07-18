// IAU rotation elements (pole RA/Dec + prime-meridian angle W) for the
// Sol planets, evaluated at model time `t`. Sources + dropped-terms
// rationale in README.md § Planet rotation.

import { J2000_JD } from '../util/astronomy-constants';
import { tToJDE } from './time';

const DEG = Math.PI / 180;
const DAYS_PER_JULIAN_CENTURY = 36525;

export interface RotationElements {
  /** Pole RA at J2000 (deg, ICRS) + linear rate (deg per Julian century). */
  readonly poleRaDeg: number;
  readonly poleRaDegPerCty: number;
  /** Pole Dec at J2000 (deg, ICRS) + linear rate (deg per Julian century). */
  readonly poleDecDeg: number;
  readonly poleDecDegPerCty: number;
  /** Prime-meridian angle W at J2000 (deg) + rotation rate (deg per day).
   *  Negative rate = retrograde spin about the IAU north pole. */
  readonly w0Deg: number;
  readonly wDegPerDay: number;
  /** East longitude (deg) at the horizontal centre of the body's
   *  equirect texture. Map metadata, not physics: the mesh renderer
   *  adds it to the spin angle so texture features land on their true
   *  longitudes. Omitted = 0 (map centred on the prime meridian). */
  readonly mapCenterLonDeg?: number;
}

export const MERCURY_ROTATION: RotationElements = {
  poleRaDeg: 281.0103, poleRaDegPerCty: -0.0328,
  poleDecDeg: 61.4155, poleDecDegPerCty: -0.0049,
  w0Deg: 329.5988, wDegPerDay: 6.1385108,
};

export const VENUS_ROTATION: RotationElements = {
  poleRaDeg: 272.76, poleRaDegPerCty: 0,
  poleDecDeg: 67.16, poleDecDegPerCty: 0,
  w0Deg: 160.20, wDegPerDay: -1.4813688,
};

export const EARTH_ROTATION: RotationElements = {
  poleRaDeg: 0, poleRaDegPerCty: -0.641,
  poleDecDeg: 90, poleDecDegPerCty: -0.557,
  w0Deg: 190.147, wDegPerDay: 360.9856235,
};

export const MARS_ROTATION: RotationElements = {
  poleRaDeg: 317.269202, poleRaDegPerCty: -0.10927547,
  poleDecDeg: 54.432516, poleDecDegPerCty: -0.05827105,
  w0Deg: 176.049863, wDegPerDay: 350.891982443297,
};

export const JUPITER_ROTATION: RotationElements = {
  poleRaDeg: 268.056595, poleRaDegPerCty: -0.006499,
  poleDecDeg: 64.495303, poleDecDegPerCty: 0.002413,
  w0Deg: 284.95, wDegPerDay: 870.5360000,
};

export const SATURN_ROTATION: RotationElements = {
  poleRaDeg: 40.589, poleRaDegPerCty: -0.036,
  poleDecDeg: 83.537, poleDecDegPerCty: -0.004,
  w0Deg: 38.90, wDegPerDay: 810.7939024,
};

export const URANUS_ROTATION: RotationElements = {
  poleRaDeg: 257.311, poleRaDegPerCty: 0,
  poleDecDeg: -15.175, poleDecDegPerCty: 0,
  w0Deg: 203.81, wDegPerDay: -501.1600928,
};

export const NEPTUNE_ROTATION: RotationElements = {
  poleRaDeg: 299.36, poleRaDegPerCty: 0,
  poleDecDeg: 43.46, poleDecDegPerCty: 0,
  w0Deg: 249.978, wDegPerDay: 541.1397757,
};

export const PLUTO_ROTATION: RotationElements = {
  poleRaDeg: 132.993, poleRaDegPerCty: 0,
  poleDecDeg: -6.163, poleDecDegPerCty: 0,
  w0Deg: 302.695, wDegPerDay: 56.3625225,
  // PIA11707 mosaic is centred on ~180°E (Sputnik Planitia at centre).
  mapCenterLonDeg: 180,
};

/** Pole RA/Dec (deg, ICRS) at Unix-seconds `t`. */
export function poleRaDecDegAt(
  rot: RotationElements,
  t: number,
): { raDeg: number; decDeg: number } {
  const T = (tToJDE(t) - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  return {
    raDeg: rot.poleRaDeg + rot.poleRaDegPerCty * T,
    decDeg: rot.poleDecDeg + rot.poleDecDegPerCty * T,
  };
}

/** Prime-meridian angle W (deg, wrapped to [0, 360)) at Unix-seconds
 *  `t`. Wrapped before use in radians — W grows to ~1e9 deg at the
 *  model-clock bounds, where an unwrapped float64 radian value has
 *  degraded precision. */
export function spinDegAt(rot: RotationElements, t: number): number {
  const d = tToJDE(t) - J2000_JD;
  const w = (rot.w0Deg + rot.wDegPerDay * d) % 360;
  return w < 0 ? w + 360 : w;
}

/** Pole unit vector in ICRS cartesian (x → vernal equinox, z → NCP). */
export function poleVectorAt(
  rot: RotationElements,
  t: number,
  out: { x: number; y: number; z: number },
): void {
  const { raDeg, decDeg } = poleRaDecDegAt(rot, t);
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  out.x = Math.cos(dec) * Math.cos(ra);
  out.y = Math.cos(dec) * Math.sin(ra);
  out.z = Math.sin(dec);
}

/** East longitude (deg, [-180, 180]) of the sub-observer point for a
 *  view direction given in ICRS — pass the body→Sun unit vector for
 *  the sub-solar longitude. Inverts the IAU body→ICRS composition
 *  Rz(90°+α0)·Rx(90°−δ0)·Rz(W). */
export function subObserverLongitudeEastDeg(
  rot: RotationElements,
  t: number,
  dirIcrs: { x: number; y: number; z: number },
): number {
  const { raDeg, decDeg } = poleRaDecDegAt(rot, t);
  const psi = (90 + raDeg) * DEG;
  const theta = (90 - decDeg) * DEG;
  const w = spinDegAt(rot, t) * DEG;

  // Rz(−ψ)
  let x = Math.cos(psi) * dirIcrs.x + Math.sin(psi) * dirIcrs.y;
  let y = -Math.sin(psi) * dirIcrs.x + Math.cos(psi) * dirIcrs.y;
  const z0 = dirIcrs.z;
  // Rx(−θ)
  const y1 = Math.cos(theta) * y + Math.sin(theta) * z0;
  // Rz(−W)
  const xb = Math.cos(w) * x + Math.sin(w) * y1;
  const yb = -Math.sin(w) * x + Math.cos(w) * y1;

  return Math.atan2(yb, xb) / DEG;
}
