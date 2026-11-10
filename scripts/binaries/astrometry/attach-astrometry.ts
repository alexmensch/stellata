// Stage 3: each component's astrometry, then the NSS inner pairs, keyed by DecomposedPair. See README.md.

import { fold } from '../../util/counts/tally-pure';
import type { ReferenceCatalogs } from '../load/reference-catalogs';
import { RESOLVE_VIA } from '../multiples-tsv';
import type { SiblingClaimedMatch } from '../resolve/athyg-match-pure';
import { SIBLING_REJECTION_TIERS } from '../resolve/cascade-pure';
import { componentsOf, freezePairs, type DecomposedPair } from '../resolve/components-pure';
import type { Stage2Result } from '../resolve/resolve-pairs';
import { NSS_SYNTHESIS_OUTCOMES, synthesizeNssInnerPairs, type NssSynthesisOutcome } from './nss-inner-pairs-pure';
import { ROUTED_VIA, routePairs, type PairAstrometry, type RoutedVia } from './routes-pure';

export interface Stage3Result {
  /** Stage 2's pairs, then the NSS inner pairs: the list Stage 4 walks. */
  readonly pairs: readonly DecomposedPair[];
  readonly astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>;
  readonly siblingClaimed: readonly SiblingClaimedMatch[];
  /** One per NSS carrier. */
  readonly nssOutcomes: readonly NssSynthesisOutcome[];
}

export function attachStage3(resolved: Stage2Result, reference: ReferenceCatalogs): Stage3Result {
  const routed = routePairs(resolved.pairs, reference.indices, reference.athyg);
  const nss = synthesizeNssInnerPairs(routed.pairs, routed.astrometry, reference.indices);
  const all = [...routed.pairs, ...nss.pairs];
  const astrometry = all.map((p) => routed.astrometry.get(p) ?? nss.astrometry.get(p)!);
  const pairs = freezePairs(all);
  return Object.freeze({
    pairs,
    astrometry: new Map(pairs.map((p, i) => [p, Object.freeze({ ...astrometry[i] })])),
    siblingClaimed: Object.freeze([...routed.siblingClaimed]),
    nssOutcomes: Object.freeze([...nss.outcomes]),
  });
}

export function routeTally(result: Stage3Result): Record<RoutedVia, number> {
  const sides = result.pairs.flatMap((p) => {
    const a = result.astrometry.get(p)!;
    return [a.primary, a.secondary];
  });
  return fold(ROUTED_VIA, sides, (a) => a.astrometryVia);
}

export function resolutionTally(result: Stage3Result): Record<(typeof RESOLVE_VIA)[number], number> {
  return fold(RESOLVE_VIA, componentsOf(result.pairs), (c) => c.resolveVia);
}

export function nssTally(result: Stage3Result): Record<NssSynthesisOutcome, number> {
  return fold(NSS_SYNTHESIS_OUTCOMES, result.nssOutcomes, (o) => o);
}

const prefixed = (prefix: string, tally: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(tally).map(([k, v]) => [`${prefix}${k}`, v]));

/** README.md#counts */
export function stage3Counts(reference: ReferenceCatalogs, resolved: Stage2Result, result: Stage3Result): Record<string, number> {
  const synthesized = nssTally(result).synthesized;
  const stage2SiblingClaimed = fold(SIBLING_REJECTION_TIERS, resolved.siblingRejections, (r) => r.tier).athyg_match_sibling_claimed;
  return {
    wds_pairs_total: reference.pairs.length + synthesized,
    synthesized_nss_inner_pairs: synthesized,
    athyg_match_sibling_claimed_rejected: stage2SiblingClaimed + result.siblingClaimed.length,
    decomposing_pairs: result.pairs.length,
    components_total: 2 * result.pairs.length,
    ...prefixed('resolution_', resolutionTally(result)),
    ...prefixed('astrometry_', routeTally(result)),
  };
}

/** The tiers whose binding carries a Gaia source_id. */
const GAIA_RESOLVE_TIERS = ['orb6_hip', 'athyg_gaia_native', 'simbad_xid'] as const;

/** The rates-snapshot keys over `stage3Counts`. */
export function stage3Rates(counts: Readonly<Record<string, number>>): Record<string, number> {
  const total = counts.components_total;
  const anchored = GAIA_RESOLVE_TIERS.reduce((n, tier) => n + counts[`resolution_${tier}`], 0);
  return {
    gaia_resolve_rate: total > 0 ? anchored / total : 0,
    hip2_fallback_rate: total > 0 ? counts.astrometry_hip2_long_baseline / total : 0,
  };
}
