// Stage 3's per-component astrometry routes and the AT-HYG position fallback, keyed by DecomposedPair. See README.md.

import { HIP2_REF_EPOCH, hip2PmDisagrees } from '../../catalog/distance/direction-cascade';
import { gaia5pUnreliable } from '../../catalog/distance/gaia-distrust';
import type { Hip2AstrometryRow } from '../../catalog/sources/hip2-source';
import type { AthygRow } from '../load/athyg-pure';
import type { GaiaAstrometryRow } from '../load/gaia-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import { ASTROMETRY_VIA, type AstrometryVia } from '../multiples-tsv';
import { pairAthygMatches, type SiblingClaimedMatch } from '../resolve/athyg-match-pure';
import {
  componentsOf, findOwningPair, pairRows, pairsByDiscoverer, type DecomposedPair, type ResolvedComponent,
} from '../resolve/components-pure';
import { ATHYG_REFERENCE_EPOCH } from '../sky-geometry-pure';

/** The routes Stage 3 tags, in priority order: every `astrometry_via` but Stage 6's `system_inherited`. */
export type RoutedVia = Exclude<AstrometryVia, 'system_inherited'>;
export const ROUTED_VIA: readonly RoutedVia[] = ASTROMETRY_VIA.filter((v): v is RoutedVia => v !== 'system_inherited');

export interface MeasuredAstrometry {
  readonly astrometryVia: Exclude<RoutedVia, 'unresolved'>;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly parallaxMas: number | null;
  readonly parallaxErrorMas: number | null;
  readonly pmraMasyr: number | null;
  readonly pmdecMasyr: number | null;
  /** The measuring catalogue's own epoch; Stage 6 advances the position to the scene epoch. */
  readonly refEpoch: number;
}

export type ComponentAstrometry = MeasuredAstrometry | { readonly astrometryVia: 'unresolved' };

export const UNRESOLVED_ASTROMETRY: ComponentAstrometry = Object.freeze({ astrometryVia: 'unresolved' });

export interface PairAstrometry {
  readonly primary: ComponentAstrometry;
  readonly secondary: ComponentAstrometry;
}

/** A source in any pair this close routes through HIP2 when the two catalogues' PMs disagree. */
export const HIP2_COMPANION_SEPARATION_ARCSEC = 5.0;

export function fromGaia(row: GaiaAstrometryRow, astrometryVia: 'gaia_5p' | 'gaia_nss_systemic'): MeasuredAstrometry {
  return Object.freeze({
    astrometryVia, raDeg: row.raDeg, decDeg: row.decDeg, parallaxMas: row.parallaxMas, parallaxErrorMas: row.parallaxErrorMas,
    pmraMasyr: row.pmraMasyr, pmdecMasyr: row.pmdecMasyr, refEpoch: row.refEpoch,
  });
}

function fromHip2(row: Hip2AstrometryRow): MeasuredAstrometry {
  return Object.freeze({
    astrometryVia: 'hip2_long_baseline', raDeg: row.raDeg, decDeg: row.decDeg, parallaxMas: row.plxMas, parallaxErrorMas: row.plxErrorMas,
    pmraMasyr: row.pmRaMasyr, pmdecMasyr: row.pmDeMasyr, refEpoch: HIP2_REF_EPOCH,
  });
}

/** Null for a row with no positive distance: it carries no parallax. */
export function fromAthygPosition(row: AthygRow): MeasuredAstrometry | null {
  if (row.distPc <= 0) return null;
  return Object.freeze({
    astrometryVia: 'athyg_position', raDeg: row.raDeg, decDeg: row.decDeg, parallaxMas: 1000 / row.distPc, parallaxErrorMas: null,
    pmraMasyr: row.pmRaMasyr, pmdecMasyr: row.pmDecMasyr, refEpoch: ATHYG_REFERENCE_EPOCH,
  });
}

function componentHip2(c: ResolvedComponent, indices: IdentifierIndices): Hip2AstrometryRow | null {
  const hip = c.hip ?? (c.gaiaSourceId === null ? null : indices.srcToHip.get(c.gaiaSourceId) ?? null);
  return hip === null ? null : indices.hipToHip2.get(hip) ?? null;
}

/** README.md#what-each-route-decides */
export function routeAstrometry(c: ResolvedComponent, minRhoArcsec: number | null, indices: IdentifierIndices): ComponentAstrometry {
  const gaia = c.gaiaSourceId === null ? null : indices.srcToAstrometry.get(c.gaiaSourceId) ?? null;
  if (gaia === null || gaia.parallaxMas === null) {
    const hip2 = componentHip2(c, indices);
    if (hip2 !== null) return fromHip2(hip2);
    if (gaia === null) return UNRESOLVED_ASTROMETRY;
  }
  if (indices.srcToNss.has(gaia.sourceId) && gaia5pUnreliable(gaia)) return fromGaia(gaia, 'gaia_nss_systemic');
  if (minRhoArcsec !== null && minRhoArcsec <= HIP2_COMPANION_SEPARATION_ARCSEC) {
    const hip2 = componentHip2(c, indices);
    if (hip2 !== null && hip2PmDisagrees(gaia, hip2)) return fromHip2(hip2);
  }
  return fromGaia(gaia, 'gaia_5p');
}

/** Each source's tightest WDS ρ, over the pair row each component's `findOwningPair` reads. */
export function minRhoPerSource(pairs: readonly DecomposedPair[]): ReadonlyMap<string, number> {
  const index = pairsByDiscoverer(pairRows(pairs));
  const out = new Map<string, number>();
  for (const c of componentsOf(pairs)) {
    if (c.gaiaSourceId === null) continue;
    const rho = findOwningPair(c, index)?.rhoLast ?? null;
    if (rho === null) continue;
    const prev = out.get(c.gaiaSourceId);
    if (prev === undefined || rho < prev) out.set(c.gaiaSourceId, rho);
  }
  return out;
}

export interface RoutedPairs {
  /** Stage 2's pairs, each component carrying the AT-HYG row the fallback matched when it had none. */
  readonly pairs: readonly DecomposedPair[];
  readonly astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>;
  /** AT-HYG fallback matches the sibling-identity guard refused. */
  readonly siblingClaimed: readonly SiblingClaimedComponent[];
}

/** A returned pair's component whose matched AT-HYG row another letter of its system binds by `hip`. */
export interface SiblingClaimedComponent {
  readonly component: ResolvedComponent;
  readonly hip: number;
}

/** The cascade for every component, then the AT-HYG position fallback over
 *  those it left unresolved, with blend inheritance. */
export function routePairs(pairs: readonly DecomposedPair[], indices: IdentifierIndices, athyg: readonly AthygRow[]): RoutedPairs {
  const minRho = minRhoPerSource(pairs);
  const components = componentsOf(pairs);
  const routed = components.map((c) => routeAstrometry(c, c.gaiaSourceId === null ? null : minRho.get(c.gaiaSourceId) ?? null, indices));
  const athygRows = components.map((c) => c.athygRow);
  const fallback = pairAthygMatches(pairs, athyg, {
    skip: (i) => routed[i].astrometryVia !== 'unresolved', allowBlendInherit: true,
  });
  for (const m of fallback.matches) {
    const synth = fromAthygPosition(athyg[m.athygIdx]);
    if (synth === null) continue;
    routed[m.componentIdx] = synth;
    athygRows[m.componentIdx] ??= athyg[m.athygIdx];
  }

  const astrometry = new Map<DecomposedPair, PairAstrometry>();
  const out = pairs.map((p, k): DecomposedPair => {
    const withRow = (c: ResolvedComponent, i: number): ResolvedComponent =>
      athygRows[i] === c.athygRow ? c : { ...c, athygRow: athygRows[i] };
    const next = { ...p, primary: withRow(p.primary, 2 * k), secondary: withRow(p.secondary, 2 * k + 1) };
    astrometry.set(next, { primary: routed[2 * k], secondary: routed[2 * k + 1] });
    return next;
  });
  const outComponents = componentsOf(out);
  const siblingClaimed = fallback.siblingClaimed.map((s: SiblingClaimedMatch) => ({ component: outComponents[s.componentIdx], hip: s.hip }));
  return { pairs: out, astrometry, siblingClaimed };
}
