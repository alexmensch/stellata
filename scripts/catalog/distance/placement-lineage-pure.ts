// Placement as a lineage stage: its reason codes, the one serialiser over each record's Placement, and parked-ledger.tsv as a view. See README.md#placement-lineage.

import type { StageLineageSpec } from '../lineage/lineage-io';
import {
  decodeLineageLine, lineageLineCode, paramsOf, paramsText, stageLineageLine,
  type LineageLine, type LineageParams, type LineageRow,
} from '../lineage/lineage-row-pure';
import { LIVE, stageCodes, type CodeDeclaration } from '../lineage/reason-codes-pure';
import { sourceRowRefText, type AnySourceRowRef } from '../../util/sources/row-ref-pure';
import type { DirectionResolution, DirectionVia } from './direction-cascade';
import type { ParallaxResolution, ParallaxTier } from './parallax/parallax-cascade';
import {
  PARKED_REASONS, parkedIdentifiersOf, parkedLedgerCells,
  type ParkedIdentifiers, type ParkedLedgerCells, type ParkedLedgerEntry, type ParkedReason, type ParkedRecord,
} from './parallax/parked-ledger';
import type { PmRescueResolution, PmRescueVia } from './pm-rescue/pm-rescue';
import type { RadialVelocityResolution, RvVia } from './radial-velocity/radial-velocity';
import type { LmcKinematicVerdict } from './refinement/distance-overrides-pure';

export const PLACEMENT_STAGE = 'placement';

export const PLACEMENT_LINEAGE: StageLineageSpec<'placement', 'placement'> = {
  stage: PLACEMENT_STAGE,
  files: ['placement'],
};

export const PLACEMENT_LINEAGE_BUDGET = { gzipBytes: 34_000_000, writeMs: 30_000 };

const live = (description: string, effect: CodeDeclaration['effect'] = 'none'): CodeDeclaration => (
  { description, effect, status: LIVE }
);

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

type DirectionOutcome = Exclude<DirectionVia, 'none'>;
const DIRECTION_BRANCHES = {
  gaia_5p: 'direction.gaia-5p',
  gaia_2p: 'direction.gaia-2p',
  gaia_nss_systemic: 'direction.gaia-nss-systemic',
  hip2_saturated: 'direction.hip2-saturated',
  hip2_pm_discrepant: 'direction.hip2-pm-discrepant',
  tycho2: 'direction.tycho2',
  cns5: 'direction.cns5',
  simbad: 'direction.simbad',
  curated: 'direction.curated',
} as const satisfies Record<DirectionOutcome, string>;

const DIRECTION_REFUSAL_BRANCHES = {
  pm_disagrees_with_hip2: 'direction.refused.pm-disagrees-with-hip2',
  no_5p_solution: 'direction.refused.no-5p-solution',
} as const satisfies Record<DirectionResolution['refusals'][number]['reason'], string>;

const PM_RESCUE_BRANCHES = {
  tycho2: 'pm-rescue.tycho2',
  cns5: 'pm-rescue.cns5',
  simbad: 'pm-rescue.simbad',
  none: 'pm-rescue.none',
} as const satisfies Record<PmRescueVia, string>;

const PM_RESCUE_REFUSAL_BRANCHES = {
  gaia_release: 'pm-rescue.refused.gaia-release',
} as const satisfies Record<PmRescueResolution['refusals'][number]['reason'], string>;

const RV_BRANCHES = {
  gaia_dr3: 'rv.gaia-dr3',
  simbad: 'rv.simbad',
  none: 'rv.none',
} as const satisfies Record<RvVia, string>;

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

const PARK = 'park';

export const PLACEMENT_CODES = stageCodes(PLACEMENT_STAGE, {
  'parallax.gaia-dr3-inversion': live('The record\'s own Gaia DR3 five-parameter parallax.'),
  'parallax.hip2-parallax': live('The record\'s own HIP in Hipparcos-2, van Leeuwen 2007 (/data/papers/index.md#vanleeuwen2007), above the S/N floor.'),
  'parallax.cns5-plx': live('The record\'s own GJ in CNS5, cited to a publication no tier above refused, above the S/N floor.'),
  'parallax.gliese-plx': live('The record\'s own GJ in V/70A, where the catalogue states its parallax is trigonometric.'),
  'parallax.simbad-plx': live('SIMBAD\'s bibcoded parallax, cited to a publication no tier above refused, above the S/N floor.'),
  'parallax.pair-member-parallax': live('A bound sibling\'s anchor-grade Gaia DR3 parallax, lent because no measurement of the record itself survived.'),
  'parallax.gliese-photometric-plx': live('V/70A\'s photometric or spectroscopic parallax estimate, the bottom tier: nothing measured reaches the record.'),
  'parallax.curated': live('Sol: distance zero by construction.'),
  'parallax.refused.below-sn-floor': live('A tier\'s parallax is below S/N 1, indistinguishable from zero, so its inverse is undefined.'),
  'parallax.refused.gaia-release': live('A courier\'s parallax cites a Gaia release on a record whose own Gaia fit is position-only, so it is the withdrawn fit returning.'),
  'parallax.refused.hipparcos2': live('A courier\'s parallax cites Hipparcos-2 on a record whose Hipparcos-2 parallax the S/N floor refused.'),
  'direction.gaia-5p': live('The record\'s own Gaia DR3 five-parameter solution.'),
  'direction.gaia-2p': live('The record\'s own Gaia DR3 position-only solution, which no Hipparcos-2 row covers.'),
  'direction.gaia-nss-systemic': live('The record\'s Gaia DR3 solution, refitted to the centre of mass: an NSS two-body orbit and an unreliable five-parameter fit.'),
  'direction.hip2-saturated': live('Hipparcos-2, where Gaia states no usable parallax for the record.'),
  'direction.hip2-pm-discrepant': live('Hipparcos-2, where the Gaia proper motion disagrees with it by more than 50 mas/yr.'),
  'direction.tycho2': live('The record\'s own TYC in Tycho-2, which neither Gaia nor Hipparcos-2 reaches.'),
  'direction.cns5': live('The record\'s own GJ in CNS5, which no tier above reaches.'),
  'direction.simbad': live('SIMBAD\'s bibcoded coordinates, the bottom tier.'),
  'direction.curated': live('Sol: the direction is arbitrary at distance zero.'),
  'direction.refused.pm-disagrees-with-hip2': live('The Gaia solution\'s proper motion disagrees with Hipparcos-2\'s by more than 50 mas/yr, the mark of an orbit-corrupted fit.'),
  'direction.refused.no-5p-solution': live('The Gaia solution is position-only and Hipparcos-2 covers the star.'),
  'pm-rescue.tycho2': live('The direction tier states no proper motion; the record\'s own TYC in Tycho-2 supplies one.'),
  'pm-rescue.cns5': live('The direction tier states no proper motion; the record\'s own GJ in CNS5 supplies one.'),
  'pm-rescue.simbad': live('The direction tier states no proper motion; SIMBAD\'s bibcoded one supplies it.'),
  'pm-rescue.none': live('The direction tier states no proper motion and no rescue tier supplies one, so the record ships static.'),
  'pm-rescue.refused.gaia-release': live('A courier\'s proper motion cites a Gaia release on a record whose own Gaia fit is position-only.'),
  'rv.gaia-dr3': live('Gaia DR3\'s RVS radial velocity on a record with a five-parameter solution.'),
  'rv.simbad': live('SIMBAD\'s bibcoded radial velocity.'),
  'rv.none': live('No tier states a radial velocity, so the radial term is zero.'),
  'rv.rejected-above-ceiling': live('The radial velocity a tier supplied exceeds the sanity ceiling on its own, so the radial term is dropped.'),
  'rv.refused.no-5p-solution': live('Gaia\'s RVS velocity on a position-only solution, whose spectrum is a blend.'),
  'rv.refused.gaia-release': live('SIMBAD\'s radial velocity cites a Gaia release on a record whose own Gaia fit is position-only.'),
  'distance.bailer-jones': live('The posterior distance of Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021) replaces the inverted Gaia DR3 parallax.'),
  'distance.bailer-jones-absent': live('The inverted Gaia DR3 parallax is eligible for a Bailer-Jones posterior that the committed pull lacks.'),
  'distance.lmc-kinematic': live('Inside the LMC cone and sharing its proper motion, the record snaps to the LMC distance.'),
  'distance.lmc-refused-by-own-parallax': live('The LMC snap is refused: the record\'s own parallax is more than 10 sigma above the LMC\'s.'),
  'velocity.clamped': live('The space velocity exceeds the sanity ceiling, so it is zeroed.'),
  'park.refused-no-defensible-parallax': live('Every parallax reaching the record was refused, so it cannot be placed.', PARK),
  'park.no-parallax-published': live('No parallax tier reaches the record, so it cannot be placed.', PARK),
  'park.no-v-magnitude': live('No V tier lights the record, so it has no brightness.', PARK),
  'park.no-position': live('No direction tier states where the record is on the sky.', PARK),
});

type Branch = Parameters<typeof PLACEMENT_CODES.code>[0];

type Tier = { tier: string };

/** Each code's params, declared once beside the codes. */
type ParamsOf<B extends Branch> =
  B extends `${string}.refused.${string}` ? Tier
  : B extends 'rv.rejected-above-ceiling' ? Tier
  : B extends `park.${string}` ? ParkedLedgerCells
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
    readonly ids: ParkedIdentifiers;
    readonly parallax: ParallaxResolution;
  }
  | {
    readonly kind: 'parked-no-v';
    readonly key: string;
    readonly ids: ParkedIdentifiers;
    readonly parallax: ParallaxResolution;
  }
  | {
    readonly kind: 'parked-no-position';
    readonly key: string;
    readonly ids: ParkedIdentifiers;
    readonly parallax: ParallaxResolution;
    readonly direction: DirectionResolution;
  }
  | {
    readonly kind: 'placed';
    readonly key: string;
    readonly parallax: ParallaxResolution;
    readonly direction: DirectionResolution;
    /** Null where the direction tier stated its own proper motion. */
    readonly pmRescue: PmRescueResolution | null;
    readonly bailerJones: BailerJonesStep;
    readonly lmc: LmcStep;
    readonly rv: RvStep;
    readonly velocityClamped: boolean;
  };

export type ParkedPlacement = Exclude<Placement, { kind: 'placed' }>;

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
    [...new Set(refs.map(sourceRowRefText))].filter((t) => t !== key);
  const row = <B extends Branch>(
    role: LineageRow['role'], branch: B, params: ParamsOf<B>, refs: readonly AnySourceRowRef[],
  ): void => {
    out.push({
      stage: PLACEMENT_STAGE, key, role, code: PLACEMENT_CODES.code(branch),
      params: paramsText(params as LineageParams), evidence: evidence(refs),
    });
  };
  const refused = <B extends Branch & `${string}.refused.${string}`>(
    branch: B, r: { tier: string; ref: AnySourceRowRef },
  ): void => row('refused', branch, { tier: r.tier } as ParamsOf<B>, [r.ref]);
  const none = {} as Record<string, never>;

  const parallax = (res: ParallaxResolution): void => {
    for (const r of res.refusals) refused(PARALLAX_REFUSAL_BRANCHES[r.reason], r);
    if (res.via !== 'none') row('outcome', PARALLAX_BRANCHES[res.via], none, res.evidence);
  };
  const direction = (res: DirectionResolution): void => {
    for (const r of res.refusals) refused(DIRECTION_REFUSAL_BRANCHES[r.reason], r);
    if (res.via !== 'none') row('outcome', DIRECTION_BRANCHES[res.via], none, res.evidence);
  };
  const park = (q: ParkedPlacement): void =>
    row('outcome', PARK_BRANCHES[parkReason(q)], parkedLedgerCells(q.ids), []);

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
        row('outcome', PM_RESCUE_BRANCHES[p.pmRescue.via], none,
          p.pmRescue.via === 'none' ? [] : p.pmRescue.evidence);
      }
      if (p.bailerJones.kind === 'override') row('outcome', 'distance.bailer-jones', none, [p.bailerJones.ref]);
      if (p.bailerJones.kind === 'absent') row('outcome', 'distance.bailer-jones-absent', none, []);
      if (p.lmc === 'snap') row('outcome', 'distance.lmc-kinematic', none, []);
      if (p.lmc === 'parallax_rules_out') row('refused', 'distance.lmc-refused-by-own-parallax', none, []);
      const { rv } = p.rv;
      for (const r of rv.refusals) refused(RV_REFUSAL_BRANCHES[r.reason], r);
      if (p.rv.kind === 'rejected') {
        row('outcome', 'rv.rejected-above-ceiling', { tier: p.rv.rv.via }, p.rv.rv.evidence);
      } else {
        row('outcome', RV_BRANCHES[rv.via], none, rv.via === 'none' ? [] : rv.evidence);
      }
      if (p.velocityClamped) row('outcome', 'velocity.clamped', none, []);
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
    entries.push({ ...parkedIdentifiersOf(paramsOf(decodeLineageLine(line)) as ParkedLedgerCells), reason });
  }
  return entries;
}

export function parkedRecord(p: Placement): ParkedRecord | null {
  if (p.kind === 'placed') return null;
  const refusedPlxMas = p.kind === 'parked-parallax' ? p.parallax.refusals.map((r) => r.mas) : [];
  return { ...p.ids, reason: parkReason(p), refusedPlxMas, originKey: p.key };
}
