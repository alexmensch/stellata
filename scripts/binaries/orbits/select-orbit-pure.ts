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
import type { AnySourceRowRef } from '../../util/sources/row-ref-pure';
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

/** Why the cascade passed over a candidate, per route, in the order its gates run. */
export const ORBIT_PASS_RULES = {
  orb6: ['unreadable', 'outranked'],
  gaia_nss: ['partner_distinct_source', 'out_of_regime', 'separation_inconsistent', 'unreadable', 'outranked'],
  orb6_spectroscopic: ['unreadable', 'outranked'],
  msc: ['measured_separation', 'unreadable', 'outranked'],
} as const satisfies Readonly<Record<OrbitViaOnFile, readonly string[]>>;

export type OrbitPassRule<R extends OrbitViaOnFile> = (typeof ORBIT_PASS_RULES)[R][number];

/** One orbit row the cascade weighed for a pair: the one it chose, or why it passed it over. */
export type OrbitCandidate = {
  [R in OrbitViaOnFile]: { readonly route: R; readonly from: AnySourceRowRef; readonly verdict: 'chosen' | OrbitPassRule<R> }
}[OrbitViaOnFile];

export interface OrbitDecision {
  readonly orbit: PairOrbit;
  /** In the cascade's order; exactly one is `chosen` unless the orbit is `none`. */
  readonly candidates: readonly OrbitCandidate[];
}

type Weighed<R extends OrbitViaOnFile> =
  | { readonly kind: 'elements'; readonly elements: OrbitElements }
  | { readonly kind: 'passed'; readonly rule: Exclude<OrbitPassRule<R>, 'outranked'> };

interface RouteCandidate<R extends OrbitViaOnFile> {
  readonly from: AnySourceRowRef;
  readonly weigh: () => Weighed<R>;
}

const passed = <R extends OrbitViaOnFile>(rule: Exclude<OrbitPassRule<R>, 'outranked'>): Weighed<R> => ({ kind: 'passed', rule });

function readable<R extends OrbitViaOnFile>(elements: OrbitElements | null): Weighed<R> {
  return elements === null ? passed<R>('unreadable' as Exclude<OrbitPassRule<R>, 'outranked'>) : { kind: 'elements', elements };
}

function orb6Candidates<R extends 'orb6' | 'orb6_spectroscopic'>(
  entries: readonly Orb6Entry[], grades: ReadonlySet<number>, plxMas: number | null,
): RouteCandidate<R>[] {
  const band = entries.filter((e) => grades.has(e.grade));
  if (band.length === 0) return [];
  const best = pickBestOrb6(band);
  return [{ from: best.origin, weigh: () => readable<R>(orb6ToCanonicalElements(best, plxMas)) }];
}

/** An NSS orbit is its source's own; a partner that is a different source
 *  means the orbit is interior to this side (../astrometry/'s NSS inner pairs). */
function nssCandidates(
  p: DecomposedPair, plxMas: number | null, systemParallaxMas: number | null, srcToNss: ReadonlyMap<string, NssOrbitRow>,
): RouteCandidate<'gaia_nss'>[] {
  const out: RouteCandidate<'gaia_nss'>[] = [];
  const seen = new Set<string>();
  for (const [side, other] of [[p.primary, p.secondary], [p.secondary, p.primary]] as const) {
    if (side.gaia === null) continue;
    const source = side.gaia.value;
    const row = srcToNss.get(source);
    if (row === undefined || seen.has(source)) continue;
    seen.add(source);
    out.push({
      from: row.origin,
      weigh: () => {
        if (other.gaia !== null && other.gaia.value !== source) return passed('partner_distinct_source');
        if (!nssInRegime(row)) return passed('out_of_regime');
        if (!nssSeparationConsistent(row, p.pair.rhoLast, plxMas ?? systemParallaxMas)) return passed('separation_inconsistent');
        return readable(nssToCanonicalElements(row, plxMas));
      },
    });
  }
  return out;
}

const subResolution = (rho: number | null): boolean => rho === null || rho <= 0;

function mscCandidates(p: DecomposedPair, rows: readonly MscOrbitRow[], plxMas: number | null): RouteCandidate<'msc'>[] {
  if (rows.length === 0) return [];
  const best = pickBestMsc(rows);
  return [{
    from: best.origin,
    weigh: () => (subResolution(p.pair.rhoLast) ? readable(mscToCanonicalElements(best, plxMas)) : passed('measured_separation')),
  }];
}

/** README.md#what-each-route-decides. Throws on an
 *  emitted epoch outside the plausible window: README.md#the-shape-of-a-result */
export function selectOrbit(
  p: DecomposedPair, astrometry: PairAstrometry, candidates: OrbitCandidates, srcToNss: ReadonlyMap<string, NssOrbitRow>,
): OrbitDecision {
  const plxMas = positiveParallaxMas(astrometry.primary) ?? positiveParallaxMas(astrometry.secondary);
  const routes: { readonly [R in OrbitViaOnFile]: () => readonly RouteCandidate<R>[] } = {
    orb6: () => orb6Candidates(candidates.orb6, ORB6_VISUAL_GRADES, plxMas),
    gaia_nss: () => nssCandidates(p, plxMas, candidates.systemParallaxMas, srcToNss),
    orb6_spectroscopic: () => orb6Candidates(candidates.orb6, ORB6_SPECTROSCOPIC_GRADES, plxMas),
    msc: () => mscCandidates(p, candidates.msc, plxMas),
  };
  let orbit: PairOrbit = NO_ORBIT;
  const weighed: OrbitCandidate[] = [];
  const weighRoute = <R extends OrbitViaOnFile>(route: R): void => {
    for (const c of routes[route]()) {
      if (orbit !== NO_ORBIT) {
        weighed.push({ route, from: c.from, verdict: 'outranked' } as OrbitCandidate);
        continue;
      }
      const w = c.weigh();
      if (w.kind === 'passed') {
        weighed.push({ route, from: c.from, verdict: w.rule } as OrbitCandidate);
        continue;
      }
      const { elements } = w;
      if (elements.pDays !== null && elements.tJd !== null && !isPlausibleT0Jd(elements.tJd)) {
        throw new Error(`Stage 4 periastron epoch out of range for ${p.pair.wdsId}/${p.pair.components} via ${route}: T_jd=${elements.tJd}`);
      }
      orbit = { orbitVia: route, elements };
      weighed.push({ route, from: c.from, verdict: 'chosen' } as OrbitCandidate);
    }
  };
  for (const route of ORBIT_VIA_ON_FILE) weighRoute(route);
  return { orbit, candidates: weighed };
}
