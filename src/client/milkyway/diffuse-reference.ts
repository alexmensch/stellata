// Published integrated-starlight photometry and the resolved-star
// subtraction that turns it into a target for the diffuse band.
// See README.md § Calibration.

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
 * cap's solid angle, from `public/catalog.bin.*` at build v9 (329,656
 * records).
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
    10 ** (-0.4 * totalMagArcsec2) - 10 ** (-0.4 * resolvedMagArcsec2);
  return residual > 0 ? -2.5 * Math.log10(residual) : null;
}

const ngpResidual = diffuseResidualMagArcsec2(
  LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole,
  RESOLVED_CATALOGUE_MAG_ARCSEC2.northGalacticPole,
);

// A null here means a catalogue rebuild moved the resolved sum past the
// published total. Failing the import is the point: the alternative is
// null coercing to 0 through EMISSIVITY_SCALE's arithmetic, which yields
// a finite, enormous emissivity and a band ten decades too bright.
if (ngpResidual === null) {
  throw new Error(
    'NGP diffuse residual is undefined: the resolved catalogue at ' +
      `${RESOLVED_CATALOGUE_MAG_ARCSEC2.northGalacticPole} mag/arcsec² is not fainter ` +
      `than Leinert's ${LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole} total. ` +
      'Re-derive both rows against the current catalogue build.',
  );
}

/**
 * The band's emissivity anchor: what is left at the NGP after the star
 * field's own contribution comes off Leinert's total.
 *
 * The NGP is the only sightline where the two inputs are commensurable.
 * Extinction there is ~0.03 mag, so the de-extincted catalogue sum and
 * the observed sky model agree to well inside their own uncertainties.
 * Toward the Galactic centre the real column is ~30 mag and the
 * difference is meaningless — `diffuseResidualMagArcsec2` returns null
 * for that pair, deliberately, rather than a plausible-looking number.
 */
export const NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2 = ngpResidual;
