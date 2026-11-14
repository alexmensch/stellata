// Stage 4's per-pair orbit cascade, in ORBIT_VIA's priority order. See README.md.

import { DAYS_PER_JULIAN_YEAR } from '../../../src/astro-core/astronomy-constants';
import type { Orb6Entry } from '../../wds/wds-pure';
import { isPlausibleT0Jd } from '../epochs-pure';
import { positiveParallaxMas } from '../astrometry/system-anchors-pure';
import type { PairAstrometry } from '../astrometry/routes-pure';
import type { NssOrbitRow } from '../load/gaia-pure';
import type { MscOrbitRow } from '../load/msc-pure';
import { ORBIT_VIA_ON_FILE, type OrbitViaOnFile } from '../multiples-record-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import {
  ORB6_SPECTROSCOPIC_GRADES, ORB6_VISUAL_GRADES, mscToCanonicalElements, orb6ToCanonicalElements, pickBestMsc, pickBestOrb6,
} from './catalog-elements-pure';
import { nssInRegime, nssToCanonicalElements, type OrbitElements } from './nss-elements-pure';

export type PairOrbit =
  | { readonly orbitVia: 'none' }
  | { readonly orbitVia: OrbitViaOnFile; readonly elements: OrbitElements };

export const NO_ORBIT: PairOrbit = Object.freeze({ orbitVia: 'none' });

/** The separation gate's Kepler bound: no plausible system is heavier, and a
 *  bound orbit's projected separation stays inside this multiple of it. */
export const NSS_MAX_SYSTEM_MASS_MSUN = 150.0;
export const NSS_SEPARATION_SANITY_RATIO = 3.0;

/** a³ = M·P², solar units; null for a non-positive input. */
export function keplerSemimajorAxisAu(pDays: number, mTotalMsun: number): number | null {
  if (pDays <= 0 || mTotalMsun <= 0) return null;
  const pYr = pDays / DAYS_PER_JULIAN_YEAR;
  return (mTotalMsun * pYr * pYr) ** (1 / 3);
}

/** False only when ρ, the parallax and the period are all known and ρ outruns
 *  the bound: README.md#what-each-route-decides */
export function nssSeparationConsistent(row: NssOrbitRow, rhoArcsec: number | null, plxMas: number | null): boolean {
  if (rhoArcsec === null || rhoArcsec <= 0) return true;
  if (plxMas === null || plxMas <= 0) return true;
  if (row.period === null) return true;
  const aMaxAu = keplerSemimajorAxisAu(row.period, NSS_MAX_SYSTEM_MASS_MSUN);
  if (aMaxAu === null) return true;
  return rhoArcsec * (1000.0 / plxMas) <= NSS_SEPARATION_SANITY_RATIO * aMaxAu;
}

/** One pair's orbit rows on file, and its system's parallax. */
export interface OrbitCandidates {
  readonly orb6: readonly Orb6Entry[];
  readonly msc: readonly MscOrbitRow[];
  /** The separation gate's distance when neither side measured one. */
  readonly systemParallaxMas: number | null;
}

function orb6Route(entries: readonly Orb6Entry[], grades: ReadonlySet<number>, plxMas: number | null): OrbitElements | null {
  const band = entries.filter((e) => grades.has(e.grade));
  return band.length === 0 ? null : orb6ToCanonicalElements(pickBestOrb6(band), plxMas);
}

/** An NSS orbit is its source's own; a partner that is a different source
 *  means the orbit is interior to this side (../astrometry/'s NSS inner pairs). */
function nssRoute(
  p: DecomposedPair, plxMas: number | null, systemParallaxMas: number | null, srcToNss: ReadonlyMap<string, NssOrbitRow>,
): OrbitElements | null {
  for (const [side, other] of [[p.primary, p.secondary], [p.secondary, p.primary]] as const) {
    if (side.gaia === null) continue;
    const source = side.gaia.value;
    if (other.gaia !== null && other.gaia.value !== source) continue;
    const row = srcToNss.get(source);
    if (row === undefined || !nssInRegime(row)) continue;
    if (!nssSeparationConsistent(row, p.pair.rhoLast, plxMas ?? systemParallaxMas)) continue;
    const elements = nssToCanonicalElements(row, plxMas);
    if (elements !== null) return elements;
  }
  return null;
}

const subResolution = (rho: number | null): boolean => rho === null || rho <= 0;

/** README.md#what-each-route-decides. Throws on an
 *  emitted epoch outside the plausible window: README.md#the-shape-of-a-result */
export function selectOrbit(
  p: DecomposedPair, astrometry: PairAstrometry, candidates: OrbitCandidates, srcToNss: ReadonlyMap<string, NssOrbitRow>,
): PairOrbit {
  const plxMas = positiveParallaxMas(astrometry.primary) ?? positiveParallaxMas(astrometry.secondary);
  const route: Readonly<Record<OrbitViaOnFile, () => OrbitElements | null>> = {
    orb6: () => orb6Route(candidates.orb6, ORB6_VISUAL_GRADES, plxMas),
    gaia_nss: () => nssRoute(p, plxMas, candidates.systemParallaxMas, srcToNss),
    orb6_spectroscopic: () => orb6Route(candidates.orb6, ORB6_SPECTROSCOPIC_GRADES, plxMas),
    msc: () => (candidates.msc.length > 0 && subResolution(p.pair.rhoLast)
      ? mscToCanonicalElements(pickBestMsc(candidates.msc), plxMas)
      : null),
  };
  for (const orbitVia of ORBIT_VIA_ON_FILE) {
    const elements = route[orbitVia]();
    if (elements === null) continue;
    if (elements.pDays !== null && elements.tJd !== null && !isPlausibleT0Jd(elements.tJd)) {
      throw new Error(`Stage 4 periastron epoch out of range for ${p.pair.wdsId}/${p.pair.components} via ${orbitVia}: T_jd=${elements.tJd}`);
    }
    return { orbitVia, elements };
  }
  return NO_ORBIT;
}
