// Placement's two count blocks — its codes' fold, and the shipped tiers folded off each placed row — and their build-log summary. See README.md#placement-counts.

import type { DistVia } from '../../../src/catalog-format/record/catalog-pure';
import type { StageCodes } from '../lineage/reason-codes/reason-codes-pure';
import { emptyTallyPartition, formatPartition, prefixed, renamed } from '../../util/counts/tally-pure';
import { isLowPrecisionParallax } from './parallax/parallax-cascade';
import {
  distViaBeforeLmc, PLACEMENT_CODES, radialVelocityApplied, shippedDistVia, shippedVelocityVia, type PlacedPlacement,
} from './placement-lineage-pure';
import { VELOCITY_VIA_VALUES, type VelocityVia } from './velocity';

/** Placement's count block: its lines folded per live code. */
export type PlacementCounts = Readonly<Record<(typeof PLACEMENT_CODES.live)[number], number>>;

export type ShippedDistTier = Exclude<DistVia, 'gaia_dr3_inversion'>;

/** The tier a distance stood on when the LMC snap weighed it. */
export type LmcWeighedTier = Exclude<ShippedDistTier, 'lmc_kinematic'>;

const SHIPPED_DIST_COUNT_KEY = {
  bailer_jones: 'distBailerJones',
  lmc_kinematic: 'distLmcKinematic',
  hip2_parallax: 'distHip2Parallax',
  cns5_plx: 'distCns5Plx',
  gliese_plx: 'distGliesePlx',
  simbad_plx: 'distSimbadPlx',
  pair_member_parallax: 'distPairMemberParallax',
  gliese_photometric_plx: 'distGliesePhotometricPlx',
  curated: 'distCurated',
} as const satisfies Record<ShippedDistTier, string>;

const VELOCITY_COUNT_KEY = {
  gaia_pm: 'velocityGaiaPm',
  hip2_pm: 'velocityHip2Pm',
  tycho2_pm: 'velocityTycho2Pm',
  cns5_pm: 'velocityCns5Pm',
  simbad_pm: 'velocitySimbadPm',
  zero: 'velocityZero',
} as const satisfies Record<VelocityVia, string>;

const LMC_OVERRIDDEN = 'lmcOverriddenByDistVia.';
const LMC_PARALLAX_REFUSED = 'lmcParallaxRefusedByDistVia.';

const SHIPPED_DIST_TIERS = Object.keys(SHIPPED_DIST_COUNT_KEY) as ShippedDistTier[];
const LMC_WEIGHED_TIERS = SHIPPED_DIST_TIERS.filter((t): t is LmcWeighedTier => t !== 'lmc_kinematic');

export type PlacementDerivedCounts =
  & Record<(typeof SHIPPED_DIST_COUNT_KEY)[ShippedDistTier], number>
  & Record<(typeof VELOCITY_COUNT_KEY)[VelocityVia], number>
  & Record<`${typeof LMC_OVERRIDDEN}${LmcWeighedTier}` | `${typeof LMC_PARALLAX_REFUSED}${LmcWeighedTier}`, number>
  & {
    distLowPrecisionParallax: number;
    velocityRvApplied: number;
    rvGaiaErrorMaxKmS: number;
  };

function shippedTier(p: PlacedPlacement, tier: DistVia): ShippedDistTier {
  if (tier === 'gaia_dr3_inversion') {
    throw new Error(`placement: ${p.key} ships a raw Gaia DR3 inversion, eligible for a Bailer-Jones posterior the pull lacks (placement.distance.bailer-jones-absent)`);
  }
  return tier;
}

function lmcWeighedTier(p: PlacedPlacement): LmcWeighedTier {
  const tier = shippedTier(p, distViaBeforeLmc(p));
  if (tier === 'lmc_kinematic') throw new Error(`placement: ${p.key} stood on the LMC snap before the snap weighed it`);
  return tier;
}

function shipsLowPrecisionParallax(p: PlacedPlacement): boolean {
  return p.parallax.via !== 'curated'
    && isLowPrecisionParallax(p.parallax.value) && shippedDistVia(p) === p.parallax.via;
}

/** A streaming fold over the placed rows, so the walk holds no Placement past its own row. */
export function placementDerivedFold(): { add(p: PlacedPlacement): void; result(): PlacementDerivedCounts } {
  const dist = emptyTallyPartition(SHIPPED_DIST_TIERS);
  const velocity = emptyTallyPartition(VELOCITY_VIA_VALUES);
  const lmcOverriddenByDistVia = emptyTallyPartition(LMC_WEIGHED_TIERS);
  const lmcParallaxRefusedByDistVia = emptyTallyPartition(LMC_WEIGHED_TIERS);
  let distLowPrecisionParallax = 0;
  let velocityRvApplied = 0;
  let rvGaiaErrorMaxKmS = 0;
  return {
    add(p) {
      dist[shippedTier(p, shippedDistVia(p))]++;
      velocity[shippedVelocityVia(p)]++;
      if (p.lmc === 'snap') lmcOverriddenByDistVia[lmcWeighedTier(p)]++;
      if (p.lmc === 'parallax_rules_out') lmcParallaxRefusedByDistVia[lmcWeighedTier(p)]++;
      if (shipsLowPrecisionParallax(p)) distLowPrecisionParallax++;
      if (radialVelocityApplied(p)) velocityRvApplied++;
      const { rv } = p.rv;
      if (p.rv.kind === 'kept' && rv.via === 'gaia_dr3') rvGaiaErrorMaxKmS = Math.max(rvGaiaErrorMaxKmS, rv.value.errorKmS);
    },
    result: (): PlacementDerivedCounts => ({
      ...renamed(SHIPPED_DIST_COUNT_KEY, dist),
      ...renamed(VELOCITY_COUNT_KEY, velocity),
      distLowPrecisionParallax,
      velocityRvApplied,
      ...prefixed(LMC_OVERRIDDEN, lmcOverriddenByDistVia),
      ...prefixed(LMC_PARALLAX_REFUSED, lmcParallaxRefusedByDistVia),
      rvGaiaErrorMaxKmS,
    }),
  };
}

type LiveBranch = typeof PLACEMENT_CODES extends StageCodes<string, string, infer L> ? L : never;

const lmcPartition = (derived: PlacementDerivedCounts, prefix: typeof LMC_OVERRIDDEN | typeof LMC_PARALLAX_REFUSED): string =>
  formatPartition(Object.fromEntries(LMC_WEIGHED_TIERS.map((t) => [t, derived[`${prefix}${t}`]])));

export function placementSummary(counts: PlacementCounts, derived: PlacementDerivedCounts): string {
  const n = (branch: LiveBranch): number => counts[`${PLACEMENT_CODES.stage}.${branch}`];
  const lmcCandidates = n('distance.lmc-kinematic') + n('distance.lmc-refused-by-own-parallax')
    + n('distance.lmc-refused-pm-outside-gate') + n('distance.lmc-refused-no-pm');
  const bjEligible = n('distance.bailer-jones') + n('distance.bailer-jones-absent');
  const rvGaia = n('rv.gaia-dr3.error-le1') + n('rv.gaia-dr3.error-le5') + n('rv.gaia-dr3.error-le10')
    + n('rv.gaia-dr3.error-le20') + n('rv.gaia-dr3.error-gt20');
  const pct = (k: number, of: number): string => `${((k / of) * 100).toFixed(1)}%`;
  return [
    `  Bailer-Jones override: ${n('distance.bailer-jones')} / ${bjEligible} Gaia-inverse-distance stars `
      + `(${pct(n('distance.bailer-jones'), bjEligible)})`,
    `  LMC kinematic override: ${n('distance.lmc-kinematic')} / ${lmcCandidates} LMC-cone stars `
      + `(${pct(n('distance.lmc-kinematic'), lmcCandidates)}); refused: PM outside the gate `
      + `${n('distance.lmc-refused-pm-outside-gate')}, no PM ${n('distance.lmc-refused-no-pm')}, `
      + `own parallax ${n('distance.lmc-refused-by-own-parallax')}`,
    `    displacing: ${lmcPartition(derived, LMC_OVERRIDDEN)}`,
    `    refused on own parallax, keeping: ${lmcPartition(derived, LMC_PARALLAX_REFUSED)}`,
    `  direction cascade: gaia_5p ${n('direction.gaia-5p')}, gaia_2p ${n('direction.gaia-2p')}, `
      + `gaia_nss_systemic ${n('direction.gaia-nss-systemic')}, hip2_saturated ${n('direction.hip2-saturated')}, `
      + `hip2_pm_discrepant ${n('direction.hip2-pm-discrepant')}, tycho2 mean ${n('direction.tycho2.mean')} / `
      + `photocentre ${n('direction.tycho2.photocentre')} / observed ${n('direction.tycho2.observed')}, `
      + `cns5 ${n('direction.cns5')}, simbad ${n('direction.simbad')}, curated ${n('direction.curated')}`,
    `  velocity cascade: ${VELOCITY_VIA_VALUES.map((v) => `${v} ${derived[VELOCITY_COUNT_KEY[v]]}`).join(', ')} `
      + `(clamped ${n('velocity.clamped')}); above escape, kept ${n('velocity.above-escape')}; `
      + `rv applied ${derived.velocityRvApplied}`,
    `  PM rescue (direction tier carries none): tycho2 ${n('pm-rescue.tycho2')}, cns5 ${n('pm-rescue.cns5')}, `
      + `simbad ${n('pm-rescue.simbad')}, ${n('pm-rescue.none.gaia-release-refused')} Gaia-bibcoded values refused `
      + `on 2p rows, ${n('pm-rescue.none.unreached')} with no owned PM`,
    `  rv cascade: gaia_dr3 ${rvGaia}, simbad ${n('rv.simbad.literature') + n('rv.simbad.gaia-release')} `
      + `(${n('rv.simbad.gaia-release')} citing a Gaia release), none ${n('rv.none')}, `
      + `rejected above the ceiling ${n('rv.rejected-above-ceiling')}; `
      + `${n('rv.refused.gaia-release')} Gaia-bibcoded values skipped on 2p rows`,
    `  rv uncertainty on the gaia_dr3 tier: <=1 ${n('rv.gaia-dr3.error-le1')}, <=5 ${n('rv.gaia-dr3.error-le5')}, `
      + `<=10 ${n('rv.gaia-dr3.error-le10')}, <=20 ${n('rv.gaia-dr3.error-le20')}, >20 ${n('rv.gaia-dr3.error-gt20')}; `
      + `max ${derived.rvGaiaErrorMaxKmS} km/s`,
    `  distance by tier: ${SHIPPED_DIST_TIERS.map((t) => `${t}=${derived[SHIPPED_DIST_COUNT_KEY[t]]}`).join(' · ')}`,
    `  parallaxes admitted below 20% precision: ${derived.distLowPrecisionParallax} `
      + '(ship, biased inversion — revisit at Gaia DR4)',
  ].join('\n');
}
