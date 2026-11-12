// Placement's two count blocks — its codes' fold, and the shipped tiers folded off each placed row — and their build-log summary. See README.md#placement-counts.

import type { DistVia } from '../../../src/catalog-format/record/catalog-pure';
import { codeCount, type LiveBranchOf } from '../lineage/reason-codes/reason-codes-pure';
import { emptyTallyPartition, formatPartition, percentOf, prefixed, renamed } from '../../util/counts/tally-pure';
import { isLowPrecisionParallax } from './parallax/parallax-cascade';
import {
  BAILER_JONES_BRANCHES, DIRECTION_BRANCHES, DIRECTION_TYCHO2_BRANCHES, distViaBeforeLmc, LMC_BRANCHES, PLACEMENT_CODES,
  PM_RESCUE_BRANCHES, radialVelocityApplied, RV_GAIA_BRANCHES, RV_SIMBAD_BRANCHES, shippedDistVia, shippedVelocityVia,
  type PlacedPlacement,
} from './placement-lineage-pure';
import { VELOCITY_VIA_VALUES, type VelocityVia } from './velocity';

/** Placement's count block: its lines folded per live code. */
export type PlacementCounts = Readonly<Record<(typeof PLACEMENT_CODES.live)[number], number>>;

type Branch = LiveBranchOf<typeof PLACEMENT_CODES>;

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
  const rawInversions: string[] = [];
  return {
    add(p) {
      const shipped = shippedDistVia(p);
      const weighed = distViaBeforeLmc(p);
      if (shipped === 'gaia_dr3_inversion' || weighed === 'gaia_dr3_inversion') rawInversions.push(p.key);
      else {
        dist[shipped]++;
        if (p.lmc === 'snap') lmcOverriddenByDistVia[weighed]++;
        if (p.lmc === 'parallax_rules_out') lmcParallaxRefusedByDistVia[weighed]++;
      }
      velocity[shippedVelocityVia(p)]++;
      if (shipsLowPrecisionParallax(p)) distLowPrecisionParallax++;
      if (radialVelocityApplied(p)) velocityRvApplied++;
      const { rv } = p.rv;
      if (p.rv.kind === 'kept' && rv.via === 'gaia_dr3') rvGaiaErrorMaxKmS = Math.max(rvGaiaErrorMaxKmS, rv.value.errorKmS);
    },
    result: (): PlacementDerivedCounts => {
      if (rawInversions.length > 0) {
        throw new Error(
          `placement: ${rawInversions.length} rows ship a raw Gaia DR3 inversion, eligible for a Bailer-Jones posterior `
            + `the pull lacks (placement.distance.bailer-jones-absent): ${rawInversions.join(', ')}`,
        );
      }
      return {
        ...renamed(SHIPPED_DIST_COUNT_KEY, dist),
        ...renamed(VELOCITY_COUNT_KEY, velocity),
        distLowPrecisionParallax,
        velocityRvApplied,
        ...prefixed(LMC_OVERRIDDEN, lmcOverriddenByDistVia),
        ...prefixed(LMC_PARALLAX_REFUSED, lmcParallaxRefusedByDistVia),
        rvGaiaErrorMaxKmS,
      };
    },
  };
}

const lmcPartition = (derived: PlacementDerivedCounts, prefix: typeof LMC_OVERRIDDEN | typeof LMC_PARALLAX_REFUSED): string =>
  formatPartition(Object.fromEntries(LMC_WEIGHED_TIERS.map((t) => [t, derived[`${prefix}${t}`]])));

export function placementSummary(counts: PlacementCounts, derived: PlacementDerivedCounts): string {
  const n = codeCount(PLACEMENT_CODES, counts);
  const sum = (branches: Readonly<Record<string, Branch>>): number =>
    Object.values(branches).reduce((total, b) => total + n(b), 0);
  const each = (branches: Readonly<Record<string, Branch>>): string =>
    Object.entries(branches).map(([tier, b]) => `${tier} ${n(b)}`).join(', ');
  const { snap, ...lmcRefusals } = LMC_BRANCHES;
  const lmcCandidates = sum(LMC_BRANCHES);
  const bjEligible = sum(BAILER_JONES_BRANCHES);
  return [
    `  Bailer-Jones override: ${n(BAILER_JONES_BRANCHES.override)} / ${bjEligible} Gaia-inverse-distance stars `
      + `(${percentOf(n(BAILER_JONES_BRANCHES.override), bjEligible)})`,
    `  LMC kinematic override: ${n(snap)} / ${lmcCandidates} LMC-cone stars `
      + `(${percentOf(n(snap), lmcCandidates)}); refused: ${each(lmcRefusals)}`,
    `    displacing: ${lmcPartition(derived, LMC_OVERRIDDEN)}`,
    `    refused on own parallax, keeping: ${lmcPartition(derived, LMC_PARALLAX_REFUSED)}`,
    `  direction cascade: ${each(DIRECTION_BRANCHES)}; tycho2 ${each(DIRECTION_TYCHO2_BRANCHES)}`,
    `  velocity cascade: ${VELOCITY_VIA_VALUES.map((v) => `${v} ${derived[VELOCITY_COUNT_KEY[v]]}`).join(', ')} `
      + `(clamped ${n('velocity.clamped')}); above escape, kept ${n('velocity.above-escape')}; `
      + `rv applied ${derived.velocityRvApplied}`,
    `  PM rescue (direction tier carries none): ${each(PM_RESCUE_BRANCHES)}`,
    `  rv cascade: gaia_dr3 ${sum(RV_GAIA_BRANCHES)}, simbad ${sum(RV_SIMBAD_BRANCHES)} (${each(RV_SIMBAD_BRANCHES)}), `
      + `none ${n('rv.none')}, rejected above the ceiling ${n('rv.rejected-above-ceiling')}; `
      + `${n('rv.refused.gaia-release')} Gaia-bibcoded values skipped on 2p rows`,
    `  rv uncertainty on the gaia_dr3 tier: ${each(RV_GAIA_BRANCHES)}; max ${derived.rvGaiaErrorMaxKmS} km/s`,
    `  distance by tier: ${SHIPPED_DIST_TIERS.map((t) => `${t}=${derived[SHIPPED_DIST_COUNT_KEY[t]]}`).join(' · ')}`,
    `  parallaxes admitted below 20% precision: ${derived.distLowPrecisionParallax} `
      + '(ship, biased inversion — revisit at Gaia DR4)',
  ].join('\n');
}
