// A proper motion for a row whose direction tier carries none: Tycho-2 by TYC
// → CNS5 by GJ → bibcoded SIMBAD, with the Gaia-bibcode skip rule. See
// README.md.

import { gaiaRefusals, refusedPublicationCited, type RefusedPublication } from '../gaia-distrust';
import type { GaiaAstrometryCatalogRow, VelocityVia } from '../direction-cascade';
import type { Tycho2Row } from '../../tycho2-parse';
import type { CitedProperMotion } from '../../cited-proper-motion';
import type { CascadeRefusal, CascadeResult, UniformValues } from '../../cascade-result';

export const PM_RESCUE_VIA_VALUES = [
  'tycho2',
  'cns5',
  'simbad',
  'none',
] as const;

export type PmRescueVia = (typeof PM_RESCUE_VIA_VALUES)[number];

/** The catalogue each rescue route credits in `velocityVia`, which pins PM
 *  provenance across the whole catalogue rather than this cohort. `none` lands
 *  on the same zero fall-through the direction tiers use. */
export const VELOCITY_VIA_BY_PM_RESCUE: Record<PmRescueVia, VelocityVia> = {
  tycho2: 'tycho2_pm',
  cns5: 'cns5_pm',
  simbad: 'simbad_pm',
  none: 'zero',
};

/** The record's own designation-joined candidates, already resolved by the
 *  callers that need them for the direction and V cascades. Tycho-2 arrives as
 *  its whole row because it publishes no per-value citation and needs none.
 *  `gaia` is the record's own Gaia row, which decides the skip rule. */
export interface PmRescueSources {
  tycho2: Tycho2Row | null;
  cns5: CitedProperMotion | null;
  simbad: CitedProperMotion | null;
  gaia: GaiaAstrometryCatalogRow | null;
}

/** A courier's PM the Gaia-bibcode skip rule rejected. */
export type PmRescueRefusal = CascadeRefusal<'cns5' | 'simbad', RefusedPublication>;

/** mas/yr, μ_α* cos δ-applied. */
export type PmRescueResolution = CascadeResult<
  UniformValues<PmRescueVia, { pmRaMasyr: number; pmDecMasyr: number }>,
  PmRescueRefusal
>;

/** The rescue's routing partition, pinned as `pmRescue*`: each tier, and the
 *  residual split by whether a skip rule refused something — "refused" and
 *  "absent" are counted apart, as the residual policy requires. */
export const PM_RESCUE_OUTCOMES = [
  'tycho2',
  'cns5',
  'simbad',
  'gaia_bibcode_skipped',
  'none',
] as const;

export type PmRescueOutcome = (typeof PM_RESCUE_OUTCOMES)[number];

export function pmRescueOutcome(res: PmRescueResolution): PmRescueOutcome {
  if (res.via !== 'none') return res.via;
  return res.refusals.length > 0 ? 'gaia_bibcode_skipped' : 'none';
}

/** Proper motion for a row the direction cascade left without one —
 *  `/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers`'s residual policy applied to the tangential
 *  term. The order is the direction cascade's own designation-joined order, so
 *  a first-order catalogue always outranks the second-order index.
 *
 *  **The skip rule** is the rv cascade's, on the quantity Gaia withheld rather
 *  than the one it published: CNS5 and SIMBAD both republish Gaia's own earlier
 *  fit under a release bibcode, so admitting it would return the motion DR3
 *  declined to state. Tycho-2 needs no such check — no Gaia reduction can be
 *  hiding behind Høg 2000 (/data/papers/index.md#hog2000).
 *  The record's 2p fit gates the rule rather than the tier, because a row with
 *  no Gaia solution has no blend to distrust and its Gaia bibcode is an
 *  ordinary citation. */
export function resolvePmRescue(
  { tycho2, cns5, simbad, gaia }: PmRescueSources,
): PmRescueResolution {
  const refusals: PmRescueRefusal[] = [];
  if (tycho2 !== null && tycho2.pmRaMasyr !== null && tycho2.pmDecMasyr !== null) {
    return {
      via: 'tycho2',
      value: { pmRaMasyr: tycho2.pmRaMasyr, pmDecMasyr: tycho2.pmDecMasyr },
      refusals,
    };
  }
  const refused = gaiaRefusals(gaia);
  for (const [via, cited] of [['cns5', cns5], ['simbad', simbad]] as const) {
    if (cited === null) continue;
    const publication = refusedPublicationCited(cited.bibcode, refused);
    if (publication !== null) {
      refusals.push({ tier: via, reason: publication });
      continue;
    }
    return {
      via,
      value: { pmRaMasyr: cited.pmRaMasyr, pmDecMasyr: cited.pmDecMasyr },
      refusals,
    };
  }
  return { via: 'none', refusals };
}
