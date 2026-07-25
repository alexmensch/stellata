// IAU rotation elements (pole RA/Dec + prime-meridian angle W) for the
// Sol planets, evaluated at model time `t`. Sources + dropped-terms
// rationale in README.md § Planet rotation.

import { J2000_JD } from '../../util/astronomy-constants';
import { tToJDE } from '../time/time';

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

// NOT the raw pck00011 linear row: Mars's linear terms are incomplete
// without the ~71-kyr NUT_PREC precession terms (RA +0.419°·sin,
// Dec +1.591°·cos, W +0.585°·sin of 0.5042615°/cty angles) — the bare
// row misplaces the pole by 1.55° and the meridian by 0.58°. These
// coefficients are that sum linearised at J2000 (≤ 0.06° error across
// the model window); texture-orientation.test.ts pins the result
// against Horizons. Do not "correct" them back to the pck row.
export const MARS_ROTATION: RotationElements = {
  poleRaDeg: 317.681106, poleRaDegPerCty: -0.10859696,
  poleDecDeg: 52.886346, poleDecDegPerCty: -0.06158182,
  w0Deg: 176.631819, wDegPerDay: 350.891982430062,
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

// The 18 major moons — same IAU WG 2015 linear terms as the planets
// (sub-degree periodic librations dropped; README.md § Planet
// rotation). Every entry is tidally locked, so |wDegPerDay| equals the
// orbital mean motion 360/periodDays (rotation-elements-pure.test.ts
// pins the parity against MOON_ELEMENTS). mapCenterLonDeg matches each
// shipped map's centre after the build's positive-east normalisation
// (data/textures/src/README.md); texture-less Uranian moons carry no
// offset.
export const MOON_ROTATION_BY_NAME: ReadonlyMap<string, RotationElements> = new Map<
  string,
  RotationElements
>([
  ['Moon', {
    poleRaDeg: 269.9949, poleRaDegPerCty: 0.0031,
    poleDecDeg: 66.5392, poleDecDegPerCty: 0.0130,
    w0Deg: 38.3213, wDegPerDay: 13.17635815,
  }],
  ['Io', {
    poleRaDeg: 268.05, poleRaDegPerCty: -0.009,
    poleDecDeg: 64.50, poleDecDegPerCty: 0.003,
    w0Deg: 200.39, wDegPerDay: 203.4889538,
  }],
  ['Europa', {
    poleRaDeg: 268.08, poleRaDegPerCty: -0.009,
    poleDecDeg: 64.51, poleDecDegPerCty: 0.003,
    w0Deg: 36.022, wDegPerDay: 101.3747235,
    mapCenterLonDeg: 180,
  }],
  ['Ganymede', {
    poleRaDeg: 268.20, poleRaDegPerCty: -0.009,
    poleDecDeg: 64.57, poleDecDegPerCty: 0.003,
    w0Deg: 44.064, wDegPerDay: 50.3176081,
    mapCenterLonDeg: 180,
  }],
  ['Callisto', {
    poleRaDeg: 268.72, poleRaDegPerCty: -0.009,
    poleDecDeg: 64.83, poleDecDegPerCty: 0.003,
    w0Deg: 259.51, wDegPerDay: 21.5710715,
    mapCenterLonDeg: 180,
  }],
  ['Mimas', {
    poleRaDeg: 40.66, poleRaDegPerCty: -0.036,
    poleDecDeg: 83.52, poleDecDegPerCty: -0.004,
    w0Deg: 333.46, wDegPerDay: 381.9945550,
    mapCenterLonDeg: 180,
  }],
  ['Enceladus', {
    poleRaDeg: 40.66, poleRaDegPerCty: -0.036,
    poleDecDeg: 83.52, poleDecDegPerCty: -0.004,
    w0Deg: 6.32, wDegPerDay: 262.7318996,
    mapCenterLonDeg: 180,
  }],
  ['Tethys', {
    poleRaDeg: 40.66, poleRaDegPerCty: -0.036,
    poleDecDeg: 83.52, poleDecDegPerCty: -0.004,
    w0Deg: 8.95, wDegPerDay: 190.6979085,
    mapCenterLonDeg: 180,
  }],
  ['Dione', {
    poleRaDeg: 40.66, poleRaDegPerCty: -0.036,
    poleDecDeg: 83.52, poleDecDegPerCty: -0.004,
    w0Deg: 357.6, wDegPerDay: 131.5349316,
    mapCenterLonDeg: 180,
  }],
  ['Rhea', {
    poleRaDeg: 40.38, poleRaDegPerCty: -0.036,
    poleDecDeg: 83.55, poleDecDegPerCty: -0.004,
    w0Deg: 235.16, wDegPerDay: 79.6900478,
    mapCenterLonDeg: 180,
  }],
  ['Titan', {
    poleRaDeg: 39.4827, poleRaDegPerCty: 0,
    poleDecDeg: 83.4279, poleDecDegPerCty: 0,
    w0Deg: 186.5855, wDegPerDay: 22.5769768,
    mapCenterLonDeg: 180,
  }],
  ['Iapetus', {
    poleRaDeg: 318.16, poleRaDegPerCty: -3.949,
    poleDecDeg: 75.03, poleDecDegPerCty: -1.143,
    w0Deg: 355.2, wDegPerDay: 4.5379572,
    mapCenterLonDeg: 180,
  }],
  ['Miranda', {
    poleRaDeg: 257.43, poleRaDegPerCty: 0,
    poleDecDeg: -15.08, poleDecDegPerCty: 0,
    w0Deg: 30.70, wDegPerDay: -254.6906892,
  }],
  ['Ariel', {
    poleRaDeg: 257.43, poleRaDegPerCty: 0,
    poleDecDeg: -15.10, poleDecDegPerCty: 0,
    w0Deg: 156.22, wDegPerDay: -142.8356681,
  }],
  ['Umbriel', {
    poleRaDeg: 257.43, poleRaDegPerCty: 0,
    poleDecDeg: -15.10, poleDecDegPerCty: 0,
    w0Deg: 108.05, wDegPerDay: -86.8688923,
  }],
  ['Titania', {
    poleRaDeg: 257.43, poleRaDegPerCty: 0,
    poleDecDeg: -15.10, poleDecDegPerCty: 0,
    w0Deg: 77.74, wDegPerDay: -41.3514316,
  }],
  ['Oberon', {
    poleRaDeg: 257.43, poleRaDegPerCty: 0,
    poleDecDeg: -15.10, poleDecDegPerCty: 0,
    w0Deg: 6.77, wDegPerDay: -26.7394932,
  }],
  ['Triton', {
    poleRaDeg: 299.36, poleRaDegPerCty: 0,
    poleDecDeg: 41.17, poleDecDegPerCty: 0,
    w0Deg: 296.53, wDegPerDay: -61.2572637,
    mapCenterLonDeg: 180,
  }],
]);

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
