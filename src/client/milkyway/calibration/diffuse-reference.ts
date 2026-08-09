// The published photometry the band is solved against and checked with:
// the Galaxy's integrated luminosity and bulge fraction, plus the
// resolved-star subtraction behind the NGP check. See README.md.

import { fluxNumber } from '../../hdr/emission/density0-solver-pure';

/**
 * Integrated V-band absolute magnitude of the Galaxy, Bland-Hawthorn &
 * Gerhard 2016 Table 2 — the total the emissivity is solved against.
 *
 * **Cite the spread, do not imply consensus.** BHG16's figure derives from
 * Milky Way analogues (Licquia, Newman & Brinchmann 2015) rather than from
 * direct integration, and it flags its own SDSS-vs-colour-index
 * inconsistency. Older direct-integration work runs 0.3–0.5 mag dimmer
 * once its B-band results are carried across at the Galaxy's integrated
 * colour: de Vaucouleurs & Pence 1978 M_B = −20.2 ± 0.15 and van der
 * Kruit 1986 M_B = −20.3 ± 0.2, against (B−V) ≈ 0.83.
 *
 * Intrinsic, i.e. corrected for internal extinction — which is what the
 * emissivity has to be, because the layer applies its own dust at render
 * time (../README.md § Dust).
 */
export const GALAXY_TOTAL_ABSMAG_V = -21.37;

/**
 * Bulge share of the Galaxy's stellar **mass**, Licquia & Newman 2015
 * (DOI 10.1088/0004-637X/806/1/96): 0.150 (+0.028/−0.019), from
 * M\* = 0.91 ± 0.07 bulge against 6.08 ± 1.14 × 10¹⁰ M⊙ total, Chabrier
 * IMF. Not the light ratio — see `BULGE_TO_TOTAL_LIGHT_V`.
 */
export const BULGE_TO_TOTAL_MASS = 0.15;

/**
 * Υ\*_V of the bulge population: Bruzual & Charlot 2003 SSP, Chabrier
 * IMF, Z = 0.02, 10 Gyr — `data/bc03/bc2003_hr_m62_chab_ssp.4color`
 * column 6 at `log-age-yr = 10.000`, read back and pinned in
 * `diffuse-reference.test.ts`.
 *
 * A single SSP for a population whose metallicity distribution is broad:
 * the bulge's is centred near solar and roughly uniformly old
 * (≥ 10 Gyr). README.md § The light ratio carries what the Z = 0.008 and
 * Z = 0.05 brackets do to the ratio below.
 */
export const BULGE_ML_V = 3.15;

/**
 * Υ\*_V of the disc, Flynn et al. 2006 (DOI
 * 10.1111/j.1365-2966.2006.10911.x): 1.5 ± 0.2 for the local column,
 * **measured** from the solar-cylinder luminosity function and mass
 * density rather than modelled. Their column includes remnants, matching
 * the mass definition behind `BULGE_TO_TOTAL_MASS`, and the paper states
 * it agrees with population synthesis at solar-neighbourhood IMFs — which
 * is what makes it commensurable with the Chabrier-IMF `BULGE_ML_V`.
 */
export const DISC_ML_V = 1.5;

/**
 * A stellar-mass bulge fraction converted to a V-band **light** fraction
 * through the two populations' Υ\*_V:
 *
 * ```
 * L_b/L_tot = 1 / (1 + ((1 − f_M)/f_M) · (Υ_b/Υ_d))
 * ```
 *
 * Only the RATIO Υ_b/Υ_d survives, which is why mixing a measured disc
 * value with a modelled bulge one is defensible: IMF normalisation
 * cancels and what is left is the population difference the whole
 * correction is about.
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
 * Bulge share of the Galaxy's V-band **light** — what the emissivity
 * solve splits flux by. No published Milky Way value exists, so it is
 * derived: 0.150 in mass buys 0.0775 in V light.
 */
export const BULGE_TO_TOTAL_LIGHT_V = bulgeToTotalLight(
  BULGE_TO_TOTAL_MASS,
  BULGE_ML_V,
  DISC_ML_V,
);

/**
 * Integrated starlight at 0.55 µm from Leinert et al. 1998, A&AS 127, 1
 * (DOI 10.1051/aas:1998105) Table 24, converted to V mag/arcsec².
 *
 * λI_λ = 577 / 250 × 10⁻⁹ W m⁻² sr⁻¹ toward the Galactic centre / the
 * NGP, against λF_λ = 1.9965e−8 W m⁻² for a V = 0 point source and
 * 1 arcsec² = 2.3504e−11 sr.
 *
 * These are **sky-model predictions** (Wainscoat et al. 1992) for TOTAL
 * starlight — every star, resolved or not.
 */
export const LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2 = {
  galacticCentre: 22.92,
  northGalacticPole: 23.83,
} as const;

/**
 * Surface brightness of the stars **Stellata already draws** — the
 * catalogue summed as Σ10^(−0.4·V) inside a 10° cap and divided by the
 * cap's solid angle, from `public/catalog.bin.*` at build v9 (329,657
 * records, `recordCount` in scripts/catalog/build-catalog-expected.json).
 *
 * Measured rather than computed at runtime: the client has no reason to
 * carry a whole-sky photometric reduction, and the catalogue is frozen
 * per release. A catalogue rebuild that moves membership or photometry
 * moves these — re-derive, don't loosen.
 *
 * `V = absmag + 5·log10(d/10)`, so these are **de-extincted**. That is
 * why only the NGP row is differenced below.
 */
export const RESOLVED_CATALOGUE_MAG_ARCSEC2 = {
  galacticCentre: 22.374,
  northGalacticPole: 24.286,
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
 * off Leinert's total — a **check** on the emissivity, not its anchor:
 * the model is solved against the Galaxy's total luminosity above, and
 * the two do not agree (README.md § Two checks).
 *
 * The NGP is the only sightline where the two inputs are commensurable.
 * Extinction there is ~0.03 mag, so the de-extincted catalogue sum and
 * the observed sky model agree to well inside their own uncertainties.
 * Toward the Galactic centre the real column is ~30 mag and the
 * difference is meaningless — `diffuseResidualMagArcsec2` returns null
 * for that pair, deliberately, rather than a plausible-looking number.
 */
export const NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2 = ngpResidual;
