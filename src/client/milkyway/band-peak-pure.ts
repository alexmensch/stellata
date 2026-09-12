// The band's brightest rendered sightline from a camera position — the
// bound the brightness skip reads (docs/science-hdr-pipeline.md § 3.5).

import { GALACTIC_CENTRE_PC, ICRS_TO_GAL_M3, R0_PC } from '../galactic/galactic-coords';
import { SB_ZERO_POINT } from '../hdr/emission/emission-pure';
import {
  DISC_RADIUS_PC,
  type Vec3,
  sightlineSurfaceBrightness,
} from './milkyway-column-pure';

const REFERENCE_STEPS = 4096;

/** Dust-free full central chord of disc + bulge, marched dense. Dust only
 *  dims, a chord through the centre is the longest and densest path, and a
 *  camera outside the proxy sees all of it — so no vantage renders a
 *  brighter pixel. */
export const MW_PEAK_SB_DUST_FREE = sightlineSurfaceBrightness(
  SB_ZERO_POINT,
  [-10 * DISC_RADIUS_PC, 0, 0],
  [1, 0, 0],
  { dustEnabled: false, steps: REFERENCE_STEPS },
);

export const BAND_PEAK_FAN_RINGS = 24;
export const BAND_PEAK_FAN_AZIMUTHS = 36;
export const BAND_PEAK_REFINE_GRID = 7;
export const BAND_PEAK_REFINE_PASSES = 3;

/** Pinned in band-peak-pure.test.ts at or above the fan's worst shortfall
 *  against a dense sweep over the vantage grid. */
export const BAND_PEAK_MARGIN_MAG = 0.05;

/** Camera travel the cached bound stays valid over at Sol's galactocentric
 *  distance, and the fastest the peak moves per parsec of that travel
 *  (vertical, near the plane — the dust scale height is 125 pc); pinned
 *  together with the margin. */
export const BAND_PEAK_RECOMPUTE_PC = 10;
export const BAND_PEAK_DRIFT_MAG_PER_PC = 0.007;

/**
 * How far the camera may travel before the cached bound is recomputed:
 * `BAND_PEAK_RECOMPUTE_PC` inside R₀, growing in proportion beyond it.
 *
 * Two different things move the peak and they do not share a scale. Inside
 * the dust the camera's own travel changes the foreground column — that is
 * the 0.007 mag/pc the floor is sized against, and it does not care how far
 * the Galactic centre is. Outside, surface brightness is distance-invariant
 * and all that is left is the Galaxy's shrinking angular size, so the same
 * travel buys proportionally less change: 2.4 kpc of it at the 2 Mpc camera
 * limit costs 0.007 mag where 10 pc at Sol costs 0.060.
 *
 * Which is why the threshold is NOT the drift rate in disguise — the rate at
 * 3 kpc above Sol is 65× the rate at Sol for the same galactocentric
 * distance. It is a conservative envelope, and `band-peak-pure.test.ts`
 * pins the staleness it actually buys over a vantage grid.
 */
export function bandPeakRecomputeRadiusPc(cameraGalPc: Vec3): number {
  return BAND_PEAK_RECOMPUTE_PC * Math.max(1, norm(cameraGalPc) / R0_PC);
}

export interface BandPeak {
  /** mag/arcsec² of the brightest sampled sightline; +Infinity if every
   *  sample misses the proxy meshes. */
  readonly sb: number;
  readonly dir: Vec3;
}

function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(v: Vec3): Vec3 {
  const n = norm(v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function toGalacticCentre(cameraGalPc: Vec3): Vec3 {
  const n = norm(cameraGalPc);
  if (n < 1e-6) return [1, 0, 0];
  return [-cameraGalPc[0] / n, -cameraGalPc[1] / n, -cameraGalPc[2] / n];
}

/** Half-angle of the cone around the Galactic-centre direction outside
 *  which every ray misses the disc proxy — the whole sphere from inside
 *  its radius. */
function fanHalfAngle(cameraGalPc: Vec3): number {
  const d = norm(cameraGalPc);
  return d <= DISC_RADIUS_PC ? Math.PI : Math.asin(DISC_RADIUS_PC / d);
}

function basisFor(axis: Vec3): { e1: Vec3; e2: Vec3 } {
  const seed: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = unit(cross(seed, axis));
  return { e1, e2: cross(axis, e1) };
}

function directionAt(
  axis: Vec3,
  e1: Vec3,
  e2: Vec3,
  theta: number,
  phi: number,
): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const u = Math.cos(phi);
  const v = Math.sin(phi);
  return [
    c * axis[0] + s * (u * e1[0] + v * e2[0]),
    c * axis[1] + s * (u * e1[1] + v * e2[1]),
    c * axis[2] + s * (u * e1[2] + v * e2[2]),
  ];
}

/**
 * Brightest dusty sightline from `cameraGalPc`, sampled on a polar fan
 * around the Galactic-centre direction — rings out to the cone that still
 * meets the disc proxy, then `BAND_PEAK_REFINE_PASSES` grids of
 * `BAND_PEAK_REFINE_GRID`² around the running maximum, each a third of the
 * previous spacing. Centring on the Galactic centre is what keeps the
 * sampling scale-free: from a megaparsec the whole Galaxy spans a couple of
 * degrees and an absolute (l, b) grid would miss it.
 */
export function bandPeakFan(
  cameraGalPc: Vec3,
  rings = BAND_PEAK_FAN_RINGS,
  azimuths = BAND_PEAK_FAN_AZIMUTHS,
): BandPeak {
  const axis = toGalacticCentre(cameraGalPc);
  const { e1, e2 } = basisFor(axis);
  const thetaMax = fanHalfAngle(cameraGalPc);
  let best = { sb: Number.POSITIVE_INFINITY, theta: 0, phi: 0, dir: axis };

  const probe = (theta: number, phi: number): void => {
    const dir = directionAt(axis, e1, e2, theta, phi);
    const sb = sightlineSurfaceBrightness(SB_ZERO_POINT, cameraGalPc, dir);
    if (sb < best.sb) best = { sb, theta, phi, dir };
  };

  let dTheta = thetaMax / (rings - 1);
  let dPhi = (2 * Math.PI) / azimuths;
  probe(0, 0);
  for (let k = 1; k < rings; k++) {
    for (let j = 0; j < azimuths; j++) probe(k * dTheta, j * dPhi);
  }

  const half = (BAND_PEAK_REFINE_GRID - 1) / 2;
  for (let pass = 0; pass < BAND_PEAK_REFINE_PASSES; pass++) {
    const centre = best;
    const stepT = dTheta / half;
    const stepP = dPhi / half;
    for (let i = -half; i <= half; i++) {
      const theta = Math.min(Math.max(centre.theta + i * stepT, 0), Math.PI);
      for (let j = -half; j <= half; j++) probe(theta, centre.phi + j * stepP);
    }
    dTheta = stepT;
    dPhi = stepP;
  }
  return { sb: best.sb, dir: best.dir };
}

/** The fan's peak made a bound: brighter by the pinned margin. */
export function bandPeakSurfaceBrightnessBound(cameraGalPc: Vec3): number {
  return bandPeakFan(cameraGalPc).sb - BAND_PEAK_MARGIN_MAG;
}

/** What a cached bound still owes at the end of its recompute radius. Sized
 *  on the vantage that pays the most — Sol, where the radius is the floor and
 *  the camera sits in the dust — and pinned over the grid, since a wider
 *  radius further out buys strictly less drift than this. */
export const BAND_PEAK_STALENESS_MAG = BAND_PEAK_DRIFT_MAG_PER_PC * BAND_PEAK_RECOMPUTE_PC;

/** Position-keyed memo of the bound, brighter again by the staleness
 *  allowance. Keyed on camera pose alone, never on exposure
 *  (hdr/exposure/README.md § One writer, five slots). */
export class BandPeakCache {
  private at: Vec3 | null = null;
  private radiusPc = 0;
  private bound = Number.NaN;

  boundAt(cameraGalPc: Vec3): number {
    if (this.at !== null) {
      const dx = cameraGalPc[0] - this.at[0];
      const dy = cameraGalPc[1] - this.at[1];
      const dz = cameraGalPc[2] - this.at[2];
      // The radius of the position the bound was TAKEN at, not of the one
      // being asked about: that is the travel the staleness allowance covers.
      if (Math.hypot(dx, dy, dz) <= this.radiusPc) return this.bound;
    }
    this.at = [cameraGalPc[0], cameraGalPc[1], cameraGalPc[2]];
    this.radiusPc = bandPeakRecomputeRadiusPc(cameraGalPc);
    this.bound = bandPeakSurfaceBrightnessBound(cameraGalPc) - BAND_PEAK_STALENESS_MAG;
    return this.bound;
  }

  /** Dispose must call this: the null sentinel is what fails the first read. */
  reset(): void {
    this.at = null;
    this.radiusPc = 0;
    this.bound = Number.NaN;
  }
}

/** Absolute ICRS heliocentric pc → the galactocentric galactic frame the
 *  mirror marches in (+x toward the centre from Sol, +z toward the NGP). */
export function galactocentricPc(absIcrsPc: Vec3): Vec3 {
  const e = ICRS_TO_GAL_M3.elements;
  const x = absIcrsPc[0] - GALACTIC_CENTRE_PC.x;
  const y = absIcrsPc[1] - GALACTIC_CENTRE_PC.y;
  const z = absIcrsPc[2] - GALACTIC_CENTRE_PC.z;
  return [
    e[0] * x + e[3] * y + e[6] * z,
    e[1] * x + e[4] * y + e[7] * z,
    e[2] * x + e[5] * y + e[8] * z,
  ];
}
