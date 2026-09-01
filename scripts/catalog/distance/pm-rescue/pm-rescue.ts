// A proper motion for a row whose direction tier carries none: Tycho-2 by TYC
// → CNS5 by GJ → bibcoded SIMBAD, with the Gaia-bibcode skip rule. See
// README.md.

import { isGaiaCatalogueBibcode } from '../gaia-distrust';
import type { VelocityVia } from '../direction-cascade';
import type { Tycho2Row } from '../../tycho2-parse';
import type { CitedProperMotion } from '../../cited-proper-motion';

export const PM_RESCUE_VIA_VALUES = [
  'tycho2',
  'cns5',
  'simbad',
  'gaia_bibcode_skipped',
  'none',
] as const;

export type PmRescueVia = (typeof PM_RESCUE_VIA_VALUES)[number];

/** The catalogue each rescue route credits in `velocityVia`, which pins PM
 *  provenance across the whole catalogue rather than this cohort. The two
 *  routes that supply no motion land on the same zero fall-through the
 *  direction tiers use. */
export const VELOCITY_VIA_BY_PM_RESCUE: Record<PmRescueVia, VelocityVia> = {
  tycho2: 'tycho2_pm',
  cns5: 'cns5_pm',
  simbad: 'simbad_pm',
  gaia_bibcode_skipped: 'zero',
  none: 'zero',
};

/** The record's own designation-joined candidates, already resolved by the
 *  callers that need them for the direction and V cascades. Tycho-2 arrives as
 *  its whole row because it publishes no per-value citation and needs none. */
export interface PmRescueSources {
  tycho2: Tycho2Row | null;
  cns5: CitedProperMotion | null;
  simbad: CitedProperMotion | null;
}

export interface PmRescueResolution {
  /** mas/yr, μ_α* cos δ-applied. Null on both zero routes. */
  pmRaMasyr: number | null;
  pmDecMasyr: number | null;
  via: PmRescueVia;
}

const NO_PM = { pmRaMasyr: null, pmDecMasyr: null } as const;

/** Proper motion for a row the direction cascade left without one —
 *  `docs/catalog-driver.md` § 5's residual policy applied to the tangential
 *  term. The order is the direction cascade's own designation-joined order, so
 *  a first-order catalogue always outranks the second-order index.
 *
 *  **The skip rule** is the rv cascade's, on the quantity Gaia withheld rather
 *  than the one it published. A 2p row is one Gaia could not fit five
 *  parameters to; CNS5 and SIMBAD both republish Gaia's own earlier fit of that
 *  same source under a Gaia release bibcode, so admitting it would return the
 *  motion DR3 declined to state. Tycho-2 needs no such check — its citation is
 *  Høg et al. 2000, which no Gaia reduction can be hiding behind. Where the row
 *  carries no Gaia solution at all there is no blend to distrust and a Gaia
 *  bibcode is an ordinary citation, so `gaiaIs2p` gates the rule rather than
 *  the tier. */
export function resolvePmRescue(
  { tycho2, cns5, simbad }: PmRescueSources,
  gaiaIs2p: boolean,
): PmRescueResolution {
  if (tycho2 !== null && tycho2.pmRaMasyr !== null && tycho2.pmDecMasyr !== null) {
    return { pmRaMasyr: tycho2.pmRaMasyr, pmDecMasyr: tycho2.pmDecMasyr, via: 'tycho2' };
  }
  let skipped = false;
  for (const [via, cited] of [['cns5', cns5], ['simbad', simbad]] as const) {
    if (cited === null) continue;
    if (gaiaIs2p && isGaiaCatalogueBibcode(cited.bibcode)) {
      skipped = true;
      continue;
    }
    return { pmRaMasyr: cited.pmRaMasyr, pmDecMasyr: cited.pmDecMasyr, via };
  }
  return { ...NO_PM, via: skipped ? 'gaia_bibcode_skipped' : 'none' };
}
