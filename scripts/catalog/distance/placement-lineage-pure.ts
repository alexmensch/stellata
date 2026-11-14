// Placement as a lineage stage: its reason codes, the one serialiser over each record's Placement, and parked-ledger.tsv as a view. See README.md#placement-lineage.

import { lineageInvariant, NO_EXCEPTIONS, type LineageInvariant } from '../lineage/lineage-invariant-pure';
import {
  decodeLineageLine, evidenceTexts, lineageLineCode, paramsOf, stageLineageLine,
  type LineageLine, type LineageParams, type LineageRow, stageRow,
} from '../lineage/lineage-row-pure';
import { outcomeCode, refusalCode, retired, stageCodes } from '../lineage/reason-codes/reason-codes-pure';
import { sourceRowRefText, type AnySourceRowRef } from '../../util/sources/row-ref-pure';
import type { DirectionResolution, DirectionVia, Tycho2SolutionKind } from './direction-cascade';
import { isGaiaCatalogueBibcode } from './gaia-distrust';
import type { ParallaxResolution, ParallaxTier } from './parallax/parallax-cascade';
import {
  PARKED_REASONS, type ParkedLedgerEntry, type ParkedReason, type ParkedRecord,
} from './parallax/parked-ledger-pure';
import {
  recordIdentifiersOf, recordKeyCells, type IdentityCells, type RecordIdentifiers,
} from '../lineage/identity-pure';
import { VELOCITY_VIA_BY_PM_RESCUE, pmRescueOutcome, type PmRescueOutcome, type PmRescueResolution } from './pm-rescue/pm-rescue';
import type { SpeedBand, VelocityVia } from './velocity';
import { rvErrorBand, type RadialVelocityResolution, type RvErrorBand } from './radial-velocity/radial-velocity';
import type { LmcKinematicVerdict } from './refinement/distance-overrides-pure';
import { PLACEMENT_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import type { DistVia } from '../../../src/catalog-format/record/catalog-pure';

export const PLACEMENT_LINEAGE_BUDGET = { gzipBytes: 34_000_000, writeMs: 60_000 };

const PARALLAX_BRANCHES = {
  gaia_dr3_inversion: 'parallax.gaia-dr3-inversion',
  hip2_parallax: 'parallax.hip2-parallax',
  cns5_plx: 'parallax.cns5-plx',
  gliese_plx: 'parallax.gliese-plx',
  simbad_plx: 'parallax.simbad-plx',
  pair_member_parallax: 'parallax.pair-member-parallax',
  gliese_photometric_plx: 'parallax.gliese-photometric-plx',
  curated: 'parallax.curated',
} as const satisfies Record<ParallaxTier, string>;

type ParallaxRefusalReason = ParallaxResolution['refusals'][number]['reason'];
const PARALLAX_REFUSAL_BRANCHES = {
  below_sn_floor: 'parallax.refused.below-sn-floor',
  gaia_release: 'parallax.refused.gaia-release',
  hipparcos2: 'parallax.refused.hipparcos2',
} as const satisfies Record<ParallaxRefusalReason, string>;

type DirectionOutcome = Exclude<DirectionVia, 'none' | 'tycho2'>;
export const DIRECTION_BRANCHES = {
  gaia_5p: 'direction.gaia-5p',
  gaia_2p: 'direction.gaia-2p',
  gaia_nss_systemic: 'direction.gaia-nss-systemic',
  hip2_saturated: 'direction.hip2-saturated',
  hip2_pm_discrepant: 'direction.hip2-pm-discrepant',
  cns5: 'direction.cns5',
  simbad: 'direction.simbad',
  curated: 'direction.curated',
} as const satisfies Record<DirectionOutcome, string>;

export const DIRECTION_TYCHO2_BRANCHES = {
  mean: 'direction.tycho2.mean',
  photocentre: 'direction.tycho2.photocentre',
  observed: 'direction.tycho2.observed',
} as const satisfies Record<Tycho2SolutionKind, string>;

const DIRECTION_REFUSAL_BRANCHES = {
  pm_disagrees_with_hip2: 'direction.refused.pm-disagrees-with-hip2',
  no_5p_solution: 'direction.refused.no-5p-solution',
} as const satisfies Record<DirectionResolution['refusals'][number]['reason'], string>;

export const PM_RESCUE_BRANCHES = {
  tycho2: 'pm-rescue.tycho2',
  cns5: 'pm-rescue.cns5',
  simbad: 'pm-rescue.simbad',
  gaia_bibcode_skipped: 'pm-rescue.none.gaia-release-refused',
  none: 'pm-rescue.none.unreached',
} as const satisfies Record<PmRescueOutcome, string>;

const PM_RESCUE_REFUSAL_BRANCHES = {
  gaia_release: 'pm-rescue.refused.gaia-release',
} as const satisfies Record<PmRescueResolution['refusals'][number]['reason'], string>;

export const RV_GAIA_BRANCHES = {
  le1: 'rv.gaia-dr3.error-le1',
  le5: 'rv.gaia-dr3.error-le5',
  le10: 'rv.gaia-dr3.error-le10',
  le20: 'rv.gaia-dr3.error-le20',
  gt20: 'rv.gaia-dr3.error-gt20',
} as const satisfies Record<RvErrorBand, string>;

const RV_REFUSAL_BRANCHES = {
  no_5p_solution: 'rv.refused.no-5p-solution',
  gaia_release: 'rv.refused.gaia-release',
} as const satisfies Record<RadialVelocityResolution['refusals'][number]['reason'], string>;

const PARK_BRANCHES = {
  refused_no_defensible_parallax: 'park.refused-no-defensible-parallax',
  no_parallax_published: 'park.no-parallax-published',
  no_v_magnitude: 'park.no-v-magnitude',
  no_position: 'park.no-position',
} as const satisfies Record<ParkedReason, string>;

export const LMC_BRANCHES = {
  snap: 'distance.lmc-kinematic',
  parallax_rules_out: 'distance.lmc-refused-by-own-parallax',
  pm_outside_gate: 'distance.lmc-refused-pm-outside-gate',
  no_pm: 'distance.lmc-refused-no-pm',
} as const satisfies Record<Exclude<LmcKinematicVerdict['kind'], 'outside_cone'>, string>;

export const RV_SIMBAD_BRANCHES = {
  literature: 'rv.simbad.literature',
  gaia_release: 'rv.simbad.gaia-release',
} as const;

export const BAILER_JONES_BRANCHES = {
  override: 'distance.bailer-jones',
  absent: 'distance.bailer-jones-absent',
} as const satisfies Record<Exclude<BailerJonesStep['kind'], 'not-applied'>, string>;

const VELOCITY_BRANCHES = {
  above_escape: 'velocity.above-escape',
  clamped: 'velocity.clamped',
} as const satisfies Record<Exclude<SpeedBand, 'bound'>, string>;

const PARK = 'park';

const RETIRED_7_1_20 = retired('7.1.20');

export const PLACEMENT_CODES = stageCodes(PLACEMENT_LINEAGE.stage, {
  'parallax.gaia-dr3-inversion': outcomeCode('The record\'s own Gaia DR3 five-parameter parallax.'),
  'parallax.hip2-parallax': outcomeCode('The record\'s own HIP in Hipparcos-2, van Leeuwen 2007 (/data/papers/index.md#vanleeuwen2007), above the S/N floor.'),
  'parallax.cns5-plx': outcomeCode('The record\'s own GJ in CNS5, cited to a publication no tier above refused, above the S/N floor.'),
  'parallax.gliese-plx': outcomeCode('The record\'s own GJ in V/70A, where the catalogue states its parallax is trigonometric.'),
  'parallax.simbad-plx': outcomeCode('SIMBAD\'s bibcoded parallax, cited to a publication no tier above refused, above the S/N floor.'),
  'parallax.pair-member-parallax': outcomeCode('A bound sibling\'s anchor-grade Gaia DR3 parallax, lent because no measurement of the record itself survived.'),
  'parallax.gliese-photometric-plx': outcomeCode('V/70A\'s photometric or spectroscopic parallax estimate, the bottom tier: nothing measured reaches the record.'),
  'parallax.curated': outcomeCode('Sol: distance zero by construction.'),
  'parallax.refused.below-sn-floor': refusalCode('A tier\'s parallax is below S/N 1, indistinguishable from zero, so its inverse is undefined.'),
  'parallax.refused.gaia-release': refusalCode('A courier\'s parallax cites a Gaia release on a record whose own Gaia fit is position-only, so it is the withdrawn fit returning.'),
  'parallax.refused.hipparcos2': refusalCode('A courier\'s parallax cites Hipparcos-2 on a record whose Hipparcos-2 parallax the S/N floor refused.'),
  'direction.gaia-5p': outcomeCode('The record\'s own Gaia DR3 five-parameter solution.'),
  'direction.gaia-2p': outcomeCode('The record\'s own Gaia DR3 position-only solution, which no Hipparcos-2 row covers.'),
  'direction.gaia-nss-systemic': outcomeCode('The record\'s Gaia DR3 solution, refitted to the centre of mass: an NSS two-body orbit and an unreliable five-parameter fit.'),
  'direction.hip2-saturated': outcomeCode('Hipparcos-2, where Gaia states no usable parallax for the record.'),
  'direction.hip2-pm-discrepant': outcomeCode('Hipparcos-2, where the Gaia proper motion disagrees with it by more than 50 mas/yr.'),
  'direction.tycho2': outcomeCode('The record\'s own TYC in Tycho-2, which neither Gaia nor Hipparcos-2 reaches.', 'none', RETIRED_7_1_20),
  'direction.tycho2.mean': outcomeCode('The record\'s own TYC in Tycho-2\'s mean solution, which neither Gaia nor Hipparcos-2 reaches.'),
  'direction.tycho2.photocentre': outcomeCode('The record\'s own TYC in Tycho-2, whose mean solution is the photocentre of a double it did not resolve.'),
  'direction.tycho2.observed': outcomeCode('The record\'s own TYC in Tycho-2, which states no mean solution, so its observed J1991.25 position.'),
  'direction.cns5': outcomeCode('The record\'s own GJ in CNS5, which no tier above reaches.'),
  'direction.simbad': outcomeCode('SIMBAD\'s bibcoded coordinates, the bottom tier.'),
  'direction.curated': outcomeCode('Sol: the direction is arbitrary at distance zero.'),
  'direction.refused.pm-disagrees-with-hip2': refusalCode('The Gaia solution\'s proper motion disagrees with Hipparcos-2\'s by more than 50 mas/yr, the mark of an orbit-corrupted fit.'),
  'direction.refused.no-5p-solution': refusalCode('The Gaia solution is position-only and Hipparcos-2 covers the star.'),
  'pm-rescue.tycho2': outcomeCode('The direction tier states no proper motion; the record\'s own TYC in Tycho-2 supplies one.'),
  'pm-rescue.cns5': outcomeCode('The direction tier states no proper motion; the record\'s own GJ in CNS5 supplies one.'),
  'pm-rescue.simbad': outcomeCode('The direction tier states no proper motion; SIMBAD\'s bibcoded one supplies it.'),
  'pm-rescue.none': outcomeCode('The direction tier states no proper motion and no rescue tier supplies one, so the record ships static.', 'none', RETIRED_7_1_20),
  'pm-rescue.none.gaia-release-refused': outcomeCode('The direction tier states no proper motion and the only one reaching the record cites a Gaia release on a position-only fit, so the record ships static.'),
  'pm-rescue.none.unreached': outcomeCode('The direction tier states no proper motion and no rescue tier reaches the record, so it ships static.'),
  'pm-rescue.refused.gaia-release': refusalCode('A courier\'s proper motion cites a Gaia release on a record whose own Gaia fit is position-only.'),
  'rv.gaia-dr3': outcomeCode('Gaia DR3\'s RVS radial velocity on a record with a five-parameter solution.', 'none', RETIRED_7_1_20),
  'rv.simbad': outcomeCode('SIMBAD\'s bibcoded radial velocity.', 'none', RETIRED_7_1_20),
  'rv.gaia-dr3.error-le1': outcomeCode('Gaia DR3\'s RVS radial velocity on a five-parameter record, stating an error of at most 1 km/s.'),
  'rv.gaia-dr3.error-le5': outcomeCode('Gaia DR3\'s RVS radial velocity on a five-parameter record, stating an error above 1 and at most 5 km/s.'),
  'rv.gaia-dr3.error-le10': outcomeCode('Gaia DR3\'s RVS radial velocity on a five-parameter record, stating an error above 5 and at most 10 km/s.'),
  'rv.gaia-dr3.error-le20': outcomeCode('Gaia DR3\'s RVS radial velocity on a five-parameter record, stating an error above 10 and at most 20 km/s.'),
  'rv.gaia-dr3.error-gt20': outcomeCode('Gaia DR3\'s RVS radial velocity on a five-parameter record, stating an error above 20 km/s.'),
  'rv.simbad.literature': outcomeCode('SIMBAD\'s radial velocity, cited to the literature.'),
  'rv.simbad.gaia-release': outcomeCode('SIMBAD\'s radial velocity, cited to a Gaia release on a record whose own Gaia fit the build does not distrust.'),
  'rv.none': outcomeCode('No tier states a radial velocity, so the radial term is zero.'),
  'rv.rejected-above-ceiling': outcomeCode('The radial velocity a tier supplied exceeds the sanity ceiling on its own, so the radial term is dropped.'),
  'rv.refused.no-5p-solution': refusalCode('Gaia\'s RVS velocity on a position-only solution, whose spectrum is a blend.'),
  'rv.refused.gaia-release': refusalCode('SIMBAD\'s radial velocity cites a Gaia release on a record whose own Gaia fit is position-only.'),
  'distance.bailer-jones': outcomeCode('The posterior distance of Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021) replaces the inverted Gaia DR3 parallax.'),
  'distance.bailer-jones-absent': outcomeCode('The inverted Gaia DR3 parallax is eligible for a Bailer-Jones posterior that the committed pull lacks.'),
  'distance.lmc-kinematic': outcomeCode('Inside the LMC cone and sharing its proper motion, the record snaps to the LMC distance.'),
  'distance.lmc-refused-by-own-parallax': refusalCode('The LMC snap is refused: the record\'s own parallax is more than 10 sigma above the LMC\'s.'),
  'distance.lmc-refused-pm-outside-gate': refusalCode('The LMC snap is refused: inside the LMC cone, but the proper motion lies outside the LMC\'s bulk-motion window.'),
  'distance.lmc-refused-no-pm': refusalCode('The LMC snap is refused: inside the LMC cone, but the record carries no proper motion to test.'),
  'velocity.clamped': outcomeCode('The space velocity exceeds the sanity ceiling, so it is zeroed.'),
  'velocity.above-escape': outcomeCode('The space velocity exceeds the Galactic escape velocity but not the sanity ceiling, so it is kept.'),
  'park.refused-no-defensible-parallax': outcomeCode('Every parallax reaching the record was refused, so it cannot be placed.', PARK),
  'park.no-parallax-published': outcomeCode('No parallax tier reaches the record, so it cannot be placed.', PARK),
  'park.no-v-magnitude': outcomeCode('No V tier lights the record, so it has no brightness.', PARK),
  'park.no-position': outcomeCode('No direction tier states where the record is on the sky.', PARK),
});

type Branch = Parameters<typeof PLACEMENT_CODES.code>[0];

export const PLACEMENT_INVARIANTS: readonly LineageInvariant[] = [
  lineageInvariant(
    PLACEMENT_CODES, 'distance.bailer-jones-absent',
    'every record Bailer-Jones is eligible for has a posterior in the committed pull (refinement/README.md#scope-derived-pulls--why-the-zero-pin-is-here)',
    NO_EXCEPTIONS,
  ),
];

type Tier = { tier: string };

/** Each code's params, declared once beside the codes. */
type ParamsOf<B extends Branch> =
  B extends `${string}.refused.${string}` ? Tier
  : B extends 'rv.rejected-above-ceiling' ? Tier
  : B extends `park.${string}` ? IdentityCells
  : Record<string, never>;

/** The distance layers above the parallax a placed record was given. */
export type BailerJonesStep =
  | { readonly kind: 'override'; readonly ref: AnySourceRowRef }
  | { readonly kind: 'absent' }
  | { readonly kind: 'not-applied' };

export type LmcStep = LmcKinematicVerdict['kind'];

/** A radial velocity the cascade answered may still be rejected past the sanity ceiling. */
export type RvStep =
  | { readonly kind: 'kept'; readonly rv: RadialVelocityResolution }
  | { readonly kind: 'rejected'; readonly rv: Exclude<RadialVelocityResolution, { via: 'none' }> };

/** One manifest row's placement: each step the walk ran, in walk order, up to
 *  the park that stopped it or the record it shipped. */
export type Placement =
  | {
    readonly kind: 'parked-parallax';
    readonly key: string;
    readonly ids: RecordIdentifiers;
    readonly parallax: ParallaxResolution;
  }
  | {
    readonly kind: 'parked-no-v';
    readonly key: string;
    readonly ids: RecordIdentifiers;
    readonly parallax: ParallaxResolution;
  }
  | {
    readonly kind: 'parked-no-position';
    readonly key: string;
    readonly ids: RecordIdentifiers;
    readonly parallax: ParallaxResolution;
    readonly direction: DirectionResolution;
  }
  | {
    readonly kind: 'placed';
    readonly key: string;
    readonly parallax: Exclude<ParallaxResolution, { via: 'none' }>;
    readonly direction: Exclude<DirectionResolution, { via: 'none' }>;
    /** Null where the direction tier stated its own proper motion. */
    readonly pmRescue: PmRescueResolution | null;
    readonly bailerJones: BailerJonesStep;
    readonly lmc: LmcStep;
    readonly rv: RvStep;
    readonly speed: SpeedBand;
  };

export type ParkedPlacement = Exclude<Placement, { kind: 'placed' }>;
export type PlacedPlacement = Extract<Placement, { kind: 'placed' }>;

type DistanceLayers = Pick<PlacedPlacement, 'parallax' | 'bailerJones' | 'lmc'>;

/** The tier a placed row's distance stood on when the LMC override weighed it. */
export function distViaBeforeLmc(p: DistanceLayers): Exclude<DistVia, 'lmc_kinematic'> {
  return p.bailerJones.kind === 'override' ? 'bailer_jones' : p.parallax.via;
}

/** The tier a placed row's shipped distance came from. */
export function shippedDistVia(p: DistanceLayers): DistVia {
  return p.lmc === 'snap' ? 'lmc_kinematic' : distViaBeforeLmc(p);
}

/** The origin ships at rest, and the sanity clamp zeroes an artifact velocity. */
function velocityZeroed(p: PlacedPlacement): boolean {
  return p.parallax.via === 'curated' || p.speed === 'clamped';
}

/** The source of a placed row's shipped proper motion; `zero` wherever its velocity was zeroed. */
export function shippedVelocityVia(p: PlacedPlacement): VelocityVia {
  if (velocityZeroed(p)) return 'zero';
  return p.pmRescue === null ? p.direction.value.velVia : VELOCITY_VIA_BY_PM_RESCUE[p.pmRescue.via];
}

/** Whether a placed row's shipped velocity carries a non-zero radial term. */
export function radialVelocityApplied(p: PlacedPlacement): boolean {
  return !velocityZeroed(p) && p.rv.kind === 'kept' && p.rv.rv.via !== 'none' && p.rv.rv.value.kmS !== 0;
}

/** The park reason, read off which step stopped the walk: the one place it is decided. */
export function parkReason(p: ParkedPlacement): ParkedReason {
  switch (p.kind) {
    case 'parked-parallax':
      return p.parallax.refusals.length > 0 ? 'refused_no_defensible_parallax' : 'no_parallax_published';
    case 'parked-no-v':
      return 'no_v_magnitude';
    case 'parked-no-position':
      return 'no_position';
    default: {
      const unmapped: never = p;
      throw new Error(`park with no reason: ${JSON.stringify(unmapped)}`);
    }
  }
}

/** Every row a Placement serialises to; the `switch` is exhaustive, so a new
 *  variant without rows fails typecheck. */
export function placementLineageRows(p: Placement): LineageRow[] {
  const { key } = p;
  const out: LineageRow[] = [];
  const evidence = (refs: readonly AnySourceRowRef[]): string[] =>
    evidenceTexts(key, refs.map(sourceRowRefText));
  const row = <B extends Branch>(branch: B, params: ParamsOf<B>, refs: readonly AnySourceRowRef[]): void => {
    out.push(stageRow(PLACEMENT_CODES, key, branch, params as LineageParams, evidence(refs)));
  };
  const refused = <B extends Branch & `${string}.refused.${string}`>(
    branch: B, r: { tier: string; ref: AnySourceRowRef },
  ): void => row(branch, { tier: r.tier } as ParamsOf<B>, [r.ref]);
  const none = {} as Record<string, never>;

  const parallax = (res: ParallaxResolution): void => {
    for (const r of res.refusals) refused(PARALLAX_REFUSAL_BRANCHES[r.reason], r);
    if (res.via !== 'none') row(PARALLAX_BRANCHES[res.via], none, res.evidence);
  };
  const direction = (res: DirectionResolution): void => {
    for (const r of res.refusals) refused(DIRECTION_REFUSAL_BRANCHES[r.reason], r);
    if (res.via === 'tycho2') row(DIRECTION_TYCHO2_BRANCHES[res.value.tycho2Solution], none, res.evidence);
    else if (res.via !== 'none') row(DIRECTION_BRANCHES[res.via], none, res.evidence);
  };
  const park = (q: ParkedPlacement): void =>
    row(PARK_BRANCHES[parkReason(q)], recordKeyCells(q.ids), []);

  switch (p.kind) {
    case 'parked-parallax':
    case 'parked-no-v':
      parallax(p.parallax);
      park(p);
      return out;
    case 'parked-no-position':
      parallax(p.parallax);
      direction(p.direction);
      park(p);
      return out;
    case 'placed': {
      parallax(p.parallax);
      direction(p.direction);
      if (p.pmRescue !== null) {
        for (const r of p.pmRescue.refusals) refused(PM_RESCUE_REFUSAL_BRANCHES[r.reason], r);
        row(PM_RESCUE_BRANCHES[pmRescueOutcome(p.pmRescue)], none,
          p.pmRescue.via === 'none' ? [] : p.pmRescue.evidence);
      }
      if (p.bailerJones.kind === 'override') row(BAILER_JONES_BRANCHES.override, none, [p.bailerJones.ref]);
      if (p.bailerJones.kind === 'absent') row(BAILER_JONES_BRANCHES.absent, none, []);
      if (p.lmc !== 'outside_cone') row(LMC_BRANCHES[p.lmc], none, []);
      const { rv } = p.rv;
      for (const r of rv.refusals) refused(RV_REFUSAL_BRANCHES[r.reason], r);
      if (p.rv.kind === 'rejected') {
        row('rv.rejected-above-ceiling', { tier: p.rv.rv.via }, p.rv.rv.evidence);
      } else if (rv.via === 'gaia_dr3') {
        row(RV_GAIA_BRANCHES[rvErrorBand(rv.value.errorKmS)], none, rv.evidence);
      } else if (rv.via === 'simbad') {
        row(RV_SIMBAD_BRANCHES[isGaiaCatalogueBibcode(rv.value.bibcode) ? 'gaia_release' : 'literature'], none, rv.evidence);
      } else {
        row('rv.none', none, []);
      }
      if (p.speed !== 'bound') row(VELOCITY_BRANCHES[p.speed], none, []);
      return out;
    }
    default: {
      const unmapped: never = p;
      throw new Error(`placement with no row mapping: ${JSON.stringify(unmapped)}`);
    }
  }
}

/** A record's rows as lines, so the walk holds strings rather than its Placements. */
export function placementLineageLines(p: Placement): LineageLine[] {
  return placementLineageRows(p).map((row) => stageLineageLine(PLACEMENT_CODES, row));
}

const REASON_BY_PARK_CODE = new Map<string, ParkedReason>(
  PARKED_REASONS.map((r) => [PLACEMENT_CODES.code(PARK_BRANCHES[r]), r]),
);

/** `data/membership/parked-ledger.tsv`, generated from the stage's park rows alone. */
export function parkedLedgerView(lines: Iterable<LineageLine>): ParkedLedgerEntry[] {
  const entries: ParkedLedgerEntry[] = [];
  for (const line of lines) {
    const reason = REASON_BY_PARK_CODE.get(lineageLineCode(line));
    if (reason === undefined) continue;
    entries.push({ ...recordIdentifiersOf(paramsOf(decodeLineageLine(line)) as IdentityCells), reason });
  }
  return entries;
}

export function parkedRecord(p: ParkedPlacement): ParkedRecord {
  const refusedPlxMas = p.kind === 'parked-parallax' ? p.parallax.refusals.map((r) => r.mas) : [];
  return { ...p.ids, reason: parkReason(p), refusedPlxMas, originKey: p.key };
}
