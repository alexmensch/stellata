// The published photometry the band is solved against and checked with:
// the Galaxy's integrated luminosity, colour and bulge fraction, plus the
// resolved-star subtraction behind the NGP check. See README.md.

import { fluxNumber } from '../../hdr/emission/density0-solver-pure';
import {
  OLD_SPHEROID_COLOUR_INDEX_BV,
  discColourIndex,
} from '../../hdr/emission/population-colour-pure';
import { RESOLVED_CATALOGUE_CAP } from './resolved-hole-table';

/**
 * Integrated V-band absolute magnitude of the Galaxy, Bland-Hawthorn 2016
 * (/data/papers/index.md#blandhawthorn2016) Table 2 — the
 * total the emissivity is solved against.
 *
 * **Cite the spread, do not imply consensus.** BHG16's figure derives from
 * Milky Way analogues (Licquia 2015b,
 * /data/papers/index.md#licquia2015b, whose own estimate is M_V = −21.51)
 * rather than from direct integration, and it flags its own
 * SDSS-vs-colour-index inconsistency. Older direct-integration work runs
 * dimmer once its B-band result is carried across at its own integrated
 * colour: de Vaucouleurs 1983 (/data/papers/index.md#devaucouleurs1983)
 * M_B = −20.2 ± 0.15 at (B−V) = 0.53, M_V ≈ −20.7, 0.64 mag dimmer; van
 * der Kruit 1986 (/data/papers/index.md#vanderkruit1986) M_B = −20.3 ± 0.2
 * at (B−V) = 0.83, M_V ≈ −21.1, 0.24 mag dimmer.
 *
 * Intrinsic, i.e. corrected for internal extinction — which is what the
 * emissivity has to be, because the layer applies its own dust at render
 * time (../column/README.md#dust--the-analytic-tier-and-what-composes-with-it).
 */
export const GALAXY_TOTAL_ABSMAG_V = -21.37;

/**
 * Bulge share of the Galaxy's stellar **mass**, Licquia 2015a
 * (/data/papers/index.md#licquia2015): 0.150 (+0.028/−0.019), from
 * M\* = 0.91 ± 0.07 bulge against 6.08 ± 1.14 × 10¹⁰ M⊙ total, Kroupa
 * IMF. Not the light ratio — see `BULGE_TO_TOTAL_LIGHT_V`.
 */
export const BULGE_TO_TOTAL_MASS = 0.15;

/**
 * Υ\*_V of the bulge population: Bruzual 2003
 * (/data/papers/index.md#bruzual2003) SSP, Chabrier IMF, Z = 0.02, 10 Gyr —
 * `data/bc03/bc2003_hr_m62_chab_ssp.4color`
 * column 6 at `log-age-yr = 10.000`, read back and pinned in
 * `diffuse-reference.test.ts`.
 *
 * A single SSP for a population whose metallicity distribution is broad:
 * the bulge's is centred near solar and roughly uniformly old
 * (≥ 10 Gyr). README.md#the-light-ratio--bt-in-the-solve-is-not-the-published-number carries what the Z = 0.008 and
 * Z = 0.05 brackets do to the ratio below.
 */
export const BULGE_ML_V = 3.15;

/**
 * Υ\*_V of the disc, Flynn 2006
 * (/data/papers/index.md#flynn2006): 1.5 ± 0.2 for the local column,
 * **measured** from the solar-cylinder luminosity function and mass
 * density rather than modelled. Their column includes remnants, matching
 * the mass definition behind `BULGE_TO_TOTAL_MASS`, and the paper states
 * it agrees with population synthesis at solar-neighbourhood IMFs — which
 * is what makes it commensurable with the Chabrier-IMF `BULGE_ML_V`.
 */
export const DISC_ML_V = 1.5;

/**
 * ```
 * L_b/L_tot = 1 / (1 + ((1 − f_M)/f_M) · (Υ_b/Υ_d))
 * ```
 *
 * Only the RATIO Υ_b/Υ_d survives, so a measured disc value and a modelled
 * bulge one are commensurable.
 *
 * Parameterised rather than inlined so the metallicity sensitivity is
 * reproducible from the other two tables in `data/bc03/`
 * (`diffuse-reference.test.ts`), not just asserted in prose.
 */
export function bulgeToTotalLight(
  massFraction: number,
  bulgeMlV: number,
  discMlV: number,
): number {
  return 1 / (1 + ((1 - massFraction) / massFraction) * (bulgeMlV / discMlV));
}

/**
 * No published Milky Way value exists, so it is derived: 0.150 in mass
 * buys 0.0775 in V light.
 */
export const BULGE_TO_TOTAL_LIGHT_V = bulgeToTotalLight(
  BULGE_TO_TOTAL_MASS,
  BULGE_ML_V,
  DISC_ML_V,
);

/**
 * Integrated (B−V) of the Galaxy, Bland-Hawthorn 2016
 * (/data/papers/index.md#blandhawthorn2016) Table 2 — the same table and
 * the same MW-analogue analysis (Licquia 2015b,
 * /data/papers/index.md#licquia2015b) behind `GALAXY_TOTAL_ABSMAG_V`, so
 * the layer's luminosity and its colour come from one system.
 *
 * BHG16 flags a ~0.1 mag inconsistency between its magnitudes and its
 * colour indices, which is the uncertainty README.md#population-colours--the-discs-is-solved-not-cited
 * weighs the alternative against.
 */
export const GALAXY_TOTAL_COLOUR_INDEX_BV = 0.73;

/**
 * (B−V) of the Galactic bulge population. The old metal-rich SSP, taken
 * from the same Bruzual 2003 (/data/papers/index.md#bruzual2003) row as
 * `BULGE_ML_V`.
 */
export const BULGE_COLOUR_INDEX_BV = OLD_SPHEROID_COLOUR_INDEX_BV;

/**
 * (B−V) of the disc population — **solved**, not cited: no publication
 * splits the Galaxy's integrated colour into components, so the published
 * total and the bulge SSP determine the disc through
 * `discColourIndex`. 0.7129.
 *
 * README.md#population-colours--the-discs-is-solved-not-cited carries why the published total wins
 * over an independently synthesised pair, and how little the answer turns
 * on the bulge (0.003 mag across the whole `data/bc03/` metallicity
 * bracket — the disc carries 92 % of the V light, so this number is
 * essentially the published total).
 */
export const DISC_COLOUR_INDEX_BV = discColourIndex(
  GALAXY_TOTAL_COLOUR_INDEX_BV,
  BULGE_COLOUR_INDEX_BV,
  BULGE_TO_TOTAL_LIGHT_V,
);

/**
 * Integrated starlight at 0.55 µm from Leinert 1998
 * (/data/papers/index.md#leinert1998) Table 24, converted to V mag/arcsec².
 *
 * λI_λ = 577 / 250 × 10⁻⁹ W m⁻² sr⁻¹ at b = 30° / the NGP, against λF_λ = 1.9965e−8 W m⁻² for a V = 0 point source and
 * 1 arcsec² = 2.3504e−11 sr.
 *
 * These are **sky-model predictions** (Wainscoat 1992,
 * /data/papers/index.md#wainscoat1992) for TOTAL starlight — every star,
 * resolved or not. `galacticCentre` holds the b = 30° column, which the
 * check grades the model's Galactic-centre sightline against.
 */
export const LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2 = {
  galacticCentre: 22.92,
  northGalacticPole: 23.83,
} as const;

/** De-extincted — only the NGP row is differenced below. */
export const RESOLVED_CATALOGUE_MAG_ARCSEC2 = {
  galacticCentre: RESOLVED_CATALOGUE_CAP.galacticCentre.magArcsec2,
  northGalacticPole: RESOLVED_CATALOGUE_CAP.northGalacticPole.magArcsec2,
} as const;

/** Surface brightness left for the diffuse layer once an already-drawn
 *  population is removed from a published total. Returns null when the
 *  resolved component alone meets or exceeds the total, which means the
 *  two are not measuring the same thing. */
export function diffuseResidualMagArcsec2(
  totalMagArcsec2: number,
  resolvedMagArcsec2: number,
): number | null {
  const residual =
    fluxNumber(totalMagArcsec2) - fluxNumber(resolvedMagArcsec2);
  return residual > 0 ? -2.5 * Math.log10(residual) : null;
}

const ngpResidual = diffuseResidualMagArcsec2(
  LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole,
  RESOLVED_CATALOGUE_MAG_ARCSEC2.northGalacticPole,
);

// A null here means a catalogue rebuild moved the resolved sum past the
// published total, i.e. the two rows stopped measuring the same thing.
// Failing the import is the point: the alternative is a nullable export
// whose consumers reach for `?? 0`, and a zero residual reads as a
// perfectly-matched check rather than a broken one.
if (ngpResidual === null) {
  throw new Error(
    'NGP diffuse residual is undefined: the resolved catalogue at ' +
      `${RESOLVED_CATALOGUE_MAG_ARCSEC2.northGalacticPole} mag/arcsec² is not fainter ` +
      `than Leinert's ${LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole} total. ` +
      'Re-derive both rows against the current catalogue build.',
  );
}

/**
 * What is left at the NGP after the star field's own contribution comes
 * off Leinert 1998's (/data/papers/index.md#leinert1998) total — a **check** on
 * the emissivity, not its anchor: the model is solved against the Galaxy's
 * total luminosity above, and
 * the two do not agree (README.md#two-checks-and-both-disagree-by-the-same-sign-and-order).
 *
 * The NGP is the only sightline where the two inputs are commensurable.
 * Extinction there is ~0.03 mag, so the de-extincted catalogue sum and
 * the observed sky model agree to well inside their own uncertainties.
 * Toward the Galactic centre the real column is ~30 mag and the
 * difference is meaningless — `diffuseResidualMagArcsec2` returns null
 * for that pair, deliberately, rather than a plausible-looking number.
 */
export const NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2 = ngpResidual;
