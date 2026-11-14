// Gaia DR3 NSS two-body orbits as canonical orbital elements, and Gaia's astrometric-detectability regime. See README.md.

import { DAYS_PER_JULIAN_YEAR, DEG_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import { jdOfJulianYear } from '../../../src/astro-core/precession';
import { GAIA_DR3_REF_EPOCH } from '../../catalog/distance/direction-cascade';
import { NSS_SOLUTION_TYPES, type NssOrbitRow } from '../load/gaia-pure';
import { pyMod } from '../python-float-pure';
import { distancePc } from '../sky-geometry-pure';

/** NSS `t_periastron` counts days from here. */
export const GAIA_DR3_REF_EPOCH_JD = jdOfJulianYear(GAIA_DR3_REF_EPOCH);

export const NSS_PERIOD_THRESHOLD_DAYS = 3 * DAYS_PER_JULIAN_YEAR;
export const NSS_SEPARATION_THRESHOLD_MAS = 1000;

/** The days / JD / radians the runtime orbit reads; null where the solution
 *  does not constrain the element. */
export interface OrbitElements {
  readonly pDays: number | null;
  readonly tJd: number | null;
  readonly e: number | null;
  readonly aAu: number | null;
  readonly iRad: number | null;
  /** ω, the argument of periastron. */
  readonly periastronRad: number | null;
  /** Ω, the longitude of the ascending node. */
  readonly nodeRad: number | null;
  /** M₂ / (M₁ + M₂). */
  readonly q: number | null;
  readonly distancePc: number | null;
}

export interface Campbell {
  readonly aMas: number;
  readonly iRad: number;
  /** In [0, π): the Thiele-Innes algebra cannot tell the ascending node from the descending one. */
  readonly nodeRad: number;
  readonly periastronRad: number;
}

/** Heintz 1978 (/data/papers/index.md#heintz1978) / Halbwachs 2023
 *  (/data/papers/index.md#halbwachs2023) Appendix A; null for a degenerate quartet. */
export function thieleInnesToCampbell(A: number, B: number, F: number, G: number): Campbell | null {
  const u = (A * A + B * B + F * F + G * G) / 2;
  const v = A * G - B * F;
  const disc = u * u - v * v;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const aSq = u + root;
  if (aSq <= 0) return null;
  const cosISq = Math.max(0, Math.min(1, (u - root) / aSq));
  const cosI = v < 0 ? -Math.sqrt(cosISq) : Math.sqrt(cosISq);
  const sum = Math.atan2(B - F, A + G);
  const diff = Math.atan2(-B - F, A - G);
  let periastronRad = (sum + diff) / 2;
  let nodeRad = (sum - diff) / 2;
  if (nodeRad < 0) {
    nodeRad += Math.PI;
    periastronRad += Math.PI;
  }
  return { aMas: Math.sqrt(aSq), iRad: Math.acos(cosI), nodeRad, periastronRad: pyMod(periastronRad, 2 * Math.PI) };
}

function rowCampbell(row: NssOrbitRow): Campbell | null {
  const { aThieleInnes: A, bThieleInnes: B, fThieleInnes: F, gThieleInnes: G } = row;
  return A === null || B === null || F === null || G === null ? null : thieleInnesToCampbell(A, B, F, G);
}

const degToRad = (deg: number | null): number | null => (deg === null ? null : deg * DEG_TO_RAD);

/** README.md#conventions-the-outputs-rest-on */
export function nssToCanonicalElements(row: NssOrbitRow, plxMas: number | null): OrbitElements | null {
  const kind = NSS_SOLUTION_TYPES.get(row.solutionType)?.kind;
  if (kind === undefined) return null;
  const angles = ((): Pick<OrbitElements, 'iRad' | 'periastronRad' | 'nodeRad'> => {
    switch (kind) {
      case 'thiele_innes': {
        const c = rowCampbell(row);
        return { iRad: c?.iRad ?? null, periastronRad: c?.periastronRad ?? null, nodeRad: c?.nodeRad ?? null };
      }
      case 'eclipsing':
        return { iRad: degToRad(row.inclination), periastronRad: degToRad(row.argPeriastron), nodeRad: null };
      case 'spectroscopic':
        return { iRad: null, periastronRad: degToRad(row.argPeriastron), nodeRad: null };
    }
  })();
  const m = row.massRatio;
  return {
    pDays: row.period,
    tJd: row.tPeriastron === null ? null : row.tPeriastron + GAIA_DR3_REF_EPOCH_JD,
    e: row.eccentricity,
    aAu: null,
    ...angles,
    q: m !== null && m > 0 ? m / (1 + m) : null,
    distancePc: distancePc(plxMas),
  };
}

/** Period under 3 yr, or a photocentre orbit under 1″; a row stating neither is outside. */
export function nssInRegime(row: NssOrbitRow): boolean {
  if (row.period !== null && row.period < NSS_PERIOD_THRESHOLD_DAYS) return true;
  if (NSS_SOLUTION_TYPES.get(row.solutionType)?.kind !== 'thiele_innes') return false;
  const c = rowCampbell(row);
  return c !== null && c.aMas < NSS_SEPARATION_THRESHOLD_MAS;
}
