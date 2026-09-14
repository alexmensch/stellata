// Sampling maths for the synthetic faint population: the census targets, the
// intrinsic-property pool drawn from real records, and the sightline tables a
// magnitude-limited draw needs. Pure.

import {
  DISC_HALF_THICKNESS_PC,
  DISC_RADIUS_PC,
  BULGE_AXIS_RATIO,
  BULGE_RADIUS_PC,
  BULGE_HALF_THICKNESS_PC,
  MAG_PER_TAU,
  SOL_GALACTOCENTRIC_PC,
  bulgeDensity,
  discDensity,
  dustTauVPerPc,
} from '../../../src/client/milkyway/milkyway-column-pure';

export type Vec3 = readonly [number, number, number];

/** ESA Gaia TAP, gaiadr3.gaia_source, counted 2026-09-14. */
export const GAIA_CENSUS_BY_G: ReadonlyMap<number, number> = new Map([
  [11, 1_247_240],
  [12, 3_087_828],
  [13, 7_369_632],
  [14, 16_844_164],
  [15, 36_909_365],
]);

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distanceModulus(distPc: number): number {
  return 5 * Math.log10(distPc / 10);
}

export function apparentMagnitude(
  absMag: number,
  distPc: number,
  extinctionMag: number,
): number {
  return absMag + distanceModulus(distPc) + extinctionMag;
}

/** The intrinsic half of a record — everything that does not depend on where
 *  the star sits. Synthetic stars reuse these tuples verbatim rather than
 *  inventing a colour/radius/class relation. */
export interface IntrinsicTuple {
  readonly absMag: number;
  readonly ci: number;
  readonly physRadius: number;
  readonly spectClass: number;
  readonly lumClass: number;
}

/** Tuples sorted brightest-first, so a magnitude-truncated draw is a prefix. */
export interface IntrinsicPool {
  readonly tuples: readonly IntrinsicTuple[];
}

export function buildIntrinsicPool(tuples: readonly IntrinsicTuple[]): IntrinsicPool {
  return { tuples: [...tuples].sort((a, b) => a.absMag - b.absMag) };
}

/** Index of the first tuple fainter than `absMagMax` — equivalently, how many
 *  of the pool a star at this distance and extinction could be drawn from. */
export function poolCountBrighterThan(pool: IntrinsicPool, absMagMax: number): number {
  const t = pool.tuples;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid].absMag <= absMagMax) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function drawTupleBrighterThan(
  pool: IntrinsicPool,
  absMagMax: number,
  rng: () => number,
): IntrinsicTuple | null {
  const n = poolCountBrighterThan(pool, absMagMax);
  if (n === 0) return null;
  return pool.tuples[Math.min(n - 1, Math.floor(rng() * n))];
}

/** Stellar number density is taken as proportional to the band's luminance
 *  density — one population, so the shapes agree up to a scale the census
 *  target fixes. Each component is clamped to its own proxy ellipsoid because
 *  the profiles themselves do not stop there; the shader's ray-sphere
 *  intersection is what bounds them at render time. */
export function numberDensityAt(rPc: number, zPc: number): number {
  const inDisc =
    rPc <= DISC_RADIUS_PC && Math.abs(zPc) <= DISC_HALF_THICKNESS_PC;
  const zBulge = zPc / BULGE_AXIS_RATIO;
  const inBulge =
    Math.sqrt(rPc * rPc + zBulge * zBulge) <= BULGE_RADIUS_PC &&
    Math.abs(zPc) <= BULGE_HALF_THICKNESS_PC;
  return (inDisc ? discDensity(rPc, zPc) : 0) + (inBulge ? bulgeDensity(rPc, zPc) : 0);
}

/** Galactocentric cylindrical coordinates of a point `distPc` from Sol along
 *  a unit direction expressed in galactic axes. */
export function galactocentricRz(
  dirGal: Vec3,
  distPc: number,
): { rPc: number; zPc: number } {
  const gx = SOL_GALACTOCENTRIC_PC[0] + dirGal[0] * distPc;
  const gy = SOL_GALACTOCENTRIC_PC[1] + dirGal[1] * distPc;
  const gz = SOL_GALACTOCENTRIC_PC[2] + dirGal[2] * distPc;
  return { rPc: Math.hypot(gx, gy), zPc: gz };
}

/** Unit direction in galactic axes for galactic longitude/latitude. */
export function galacticUnitVector(lRad: number, bRad: number): Vec3 {
  const cb = Math.cos(bRad);
  return [cb * Math.cos(lRad), cb * Math.sin(lRad), Math.sin(bRad)];
}

export interface SightlineStep {
  readonly distPc: number;
  readonly extinctionMag: number;
  readonly density: number;
}

/** Marches one sightline out to `maxPc`, accumulating the analytic dust column
 *  as it goes. The extinction returned at each step is the column from Sol to
 *  that step, which is what a magnitude-limited selection needs. */
export function marchSightline(
  dirGal: Vec3,
  maxPc: number,
  steps: number,
  extinctionStrength = 1,
): SightlineStep[] {
  const out: SightlineStep[] = [];
  const ds = maxPc / steps;
  let tau = 0;
  for (let i = 0; i < steps; i++) {
    const distPc = (i + 0.5) * ds;
    const { rPc, zPc } = galactocentricRz(dirGal, distPc);
    tau += dustTauVPerPc(rPc, zPc, extinctionStrength) * ds;
    out.push({ distPc, extinctionMag: tau * MAG_PER_TAU, density: numberDensityAt(rPc, zPc) });
  }
  return out;
}

/** Per-step weight of a magnitude-limited draw along one sightline: the shell
 *  volume element times the density times the share of the pool still bright
 *  enough at that distance and extinction. */
export function sightlineWeights(
  march: readonly SightlineStep[],
  pool: IntrinsicPool,
  limitMag: number,
  solidAngle: number,
  minDistPc: number,
): number[] {
  const ds = march.length > 1 ? march[1].distPc - march[0].distPc : 0;
  return march.map((s) => {
    if (s.distPc < minDistPc || s.density <= 0) return 0;
    const absMagMax = limitMag - distanceModulus(s.distPc) - s.extinctionMag;
    const n = poolCountBrighterThan(pool, absMagMax);
    if (n === 0) return 0;
    const shell = solidAngle * s.distPc * s.distPc * ds;
    return s.density * shell * (n / pool.tuples.length);
  });
}

/** In-place prefix sum. The last entry is the total, and `sampleCdf` treats a
 *  zero total as "nothing to draw". */
export function toCdf(weights: readonly number[]): number[] {
  const cdf: number[] = new Array(weights.length);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    cdf[i] = acc;
  }
  return cdf;
}

export function sampleCdf(cdf: readonly number[], u: number): number {
  const total = cdf[cdf.length - 1];
  if (!(total > 0)) return -1;
  const target = u * total;
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Equal-area cells over the sphere: longitude uniform, latitude uniform in
 *  sin b, so every cell carries the same solid angle. */
export interface SkyCell {
  readonly lRad: number;
  readonly bRad: number;
}

export function equalAreaSkyGrid(nLon: number, nSinB: number): SkyCell[] {
  const cells: SkyCell[] = [];
  for (let j = 0; j < nSinB; j++) {
    const sinB = -1 + (2 * (j + 0.5)) / nSinB;
    const bRad = Math.asin(sinB);
    for (let i = 0; i < nLon; i++) {
      cells.push({ lRad: (2 * Math.PI * (i + 0.5)) / nLon, bRad });
    }
  }
  return cells;
}

export function skyCellSolidAngle(nLon: number, nSinB: number): number {
  return (4 * Math.PI) / (nLon * nSinB);
}
