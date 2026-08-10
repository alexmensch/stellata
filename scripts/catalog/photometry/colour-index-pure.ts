// Johnson B−V resolution from Gaia DR3 photometry, the catalogue's printed
// cell, and the intrinsic spectral-class tiers. See README.md § The ci cascade.

import { SOLAR_BV_FALLBACK } from '../catalog-pure';
import {
  calibratedPhotometry,
  polynomial,
  type GaiaPhotometry,
} from './gaia-photometry-pure';
import { RIELLO_BP_RP_MIN, rielloGMinusV } from './v-magnitude-pure';

/** Gaia DR3 documentation Table 5.9 (the release-3 restatement of Riello+
 *  2021, A&A 649, A3 App. C) — `G − B` as a quartic in `BP − RP`, ascending
 *  powers. Sibling of the `G − V` cubic in the same table, which is what makes
 *  their difference a published B−V rather than a composed guess. */
export const GAIA_G_MINUS_B_COEFFS = [
  0.01448, -0.6874, -0.3604, 0.06718, -0.006061,
] as const;

/** Published residual scatter of the relation above (mag). */
export const GAIA_G_MINUS_B_SIGMA = 0.0633;

/** Blue end of the `G − B` relation's stated range. It coincides with the
 *  `G − V` cubic's {@link RIELLO_BP_RP_MIN}, which is why the difference has one
 *  blue bound and not two — stated separately so a future table revision that
 *  moves one relation and not the other shows up here rather than silently
 *  widening the other's range. */
export const GAIA_G_MINUS_B_BP_RP_MIN = -0.5;

/** Red end of the `G − B` relation's stated range. Redder than
 *  {@link GAIA_G_MINUS_B_GIANT_ONLY_BP_RP} the table restricts it to M giants,
 *  and the build cannot tell a giant from a dwarf on the no-Apsis population
 *  the tier serves, so that narrower bound is what the transform gates on and
 *  this constant exists only to state what was given up. */
export const GAIA_G_MINUS_B_BP_RP_MAX = 4.0;

/** Table 5.9 note (k): past this colour `G − B = f(BP − RP)` holds for M
 *  giants only. */
export const GAIA_G_MINUS_B_GIANT_ONLY_BP_RP = 1.75;

/** `G − B` from the Table 5.9 quartic — the algebra alone, ungated. */
export function gaiaGMinusB(bpMinusRp: number): number {
  return polynomial(GAIA_G_MINUS_B_COEFFS, bpMinusRp);
}

/** Johnson B−V transformed from a Gaia photometry row, or null when the pair
 *  of relations does not apply: a band missing or non-finite, G below the
 *  saturation bound, or the colour outside the range both hold over.
 *
 *  `B − V = (G − V) − (G − B)`. G cancels, so the transform is a function of
 *  colour alone — the saturation gate stays because it marks the regime the
 *  relations were fitted in, not because G enters the algebra. */
export function gaiaBMinusV(photometry: GaiaPhotometry | null): number | null {
  const calibrated = calibratedPhotometry(photometry);
  if (calibrated === null) return null;
  const { bpMinusRp } = calibrated;
  const blueBound = Math.max(RIELLO_BP_RP_MIN, GAIA_G_MINUS_B_BP_RP_MIN);
  if (bpMinusRp < blueBound || bpMinusRp > GAIA_G_MINUS_B_GIANT_ONLY_BP_RP) {
    return null;
  }
  return rielloGMinusV(bpMinusRp) - gaiaGMinusB(bpMinusRp);
}

export const CI_VIA_VALUES = [
  'gaia_relation',
  'catalogued',
  'spectral_derived',
  'solar_fallback',
] as const;

export type CiVia = (typeof CI_VIA_VALUES)[number];

export interface ColourIndexResolution {
  ci: number;
  via: CiVia;
  /** Whether the value is observed-convention — reddened by the real Sol→star
   *  extinction, so build-time de-extinction must subtract `A_V / R_V` from it.
   *  True for the two measured tiers, false for the two derived ones, which
   *  are intrinsic already. `companionCiIsObserved` gates on the same contract;
   *  getting it wrong double-counts extinction. */
  isObserved: boolean;
}

/** One row's candidate colours, one per tier below the relation. Named rather
 *  than positional because three of them are `number | null` and a swap would
 *  silently reorder the cascade while still typechecking. */
export interface ColourIndexSources {
  photometry: GaiaPhotometry | null;
  /** The spine's printed `ci` cell. */
  cataloguedCi: number | null;
  /** Non-null suppresses both derived tiers — see below. */
  apsisTeff: number | null;
  /** `spectralClassCi`, or null where the class yields no real colour. */
  spectralCi: number | null;
}

/** B−V through the cascade: the Gaia relation, else the catalogue's printed
 *  cell, else — only where no Apsis Teff will override the colour downstream —
 *  the intrinsic spectral-class value, else solar.
 *  `docs/catalog-driver.md` § 5.
 *
 *  The two derived tiers are gated on `apsisTeff === null` because the shader
 *  reads `iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi`: deriving a colour an
 *  Apsis star will never render is work whose only effect would be to move the
 *  routing counts. */
export function resolveColourIndex(
  sources: ColourIndexSources,
): ColourIndexResolution {
  const { cataloguedCi, apsisTeff, spectralCi } = sources;
  const transformed = gaiaBMinusV(sources.photometry);
  if (transformed !== null) {
    return { ci: transformed, via: 'gaia_relation', isObserved: true };
  }
  if (cataloguedCi !== null && Number.isFinite(cataloguedCi)) {
    return { ci: cataloguedCi, via: 'catalogued', isObserved: true };
  }
  if (apsisTeff === null && spectralCi !== null) {
    return { ci: spectralCi, via: 'spectral_derived', isObserved: false };
  }
  return { ci: SOLAR_BV_FALLBACK, via: 'solar_fallback', isObserved: false };
}
